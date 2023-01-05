import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';
import { setupFixture } from './fixtures';
import hre from 'hardhat';
import { time_travel } from '../test.utils';

describe.only('TapiocaOptionLiquidityProvision', () => {
    it('should check initial state', async () => {
        const { tOLP, signer } = await loadFixture(setupFixture);

        expect(await tOLP.owner()).to.be.eq(signer.address);
        expect(await tOLP.getSingularities()).to.be.deep.eq([]);
        expect(await tOLP.tokenCounter()).to.be.eq(0);
    });

    it('should register a singularity', async () => {
        const { users, tOLP, sglTokenMock, sglTokenMockAsset, sglTokenMock2, sglTokenMock2Asset } = await loadFixture(setupFixture);

        // Only owner can register a singularity
        await expect(tOLP.connect(users[0]).registerSingularity(sglTokenMock.address, sglTokenMockAsset)).to.be.revertedWith(
            'Ownable: caller is not the owner',
        );

        // Register a singularity
        await expect(tOLP.registerSingularity(sglTokenMock.address, sglTokenMockAsset))
            .to.emit(tOLP, 'RegisterSingularity')
            .withArgs(sglTokenMock.address, sglTokenMockAsset);

        expect(await tOLP.getSingularities()).to.be.deep.eq([sglTokenMockAsset]);
        expect((await tOLP.activeSingularities(sglTokenMock.address)).sglAssetID).to.be.eq(sglTokenMockAsset);

        await expect(tOLP.registerSingularity(sglTokenMock2.address, sglTokenMock2Asset))
            .to.emit(tOLP, 'RegisterSingularity')
            .withArgs(sglTokenMock2.address, sglTokenMock2Asset);

        expect(await tOLP.getSingularities()).to.be.deep.eq([sglTokenMockAsset, sglTokenMock2Asset]);
        expect((await tOLP.activeSingularities(sglTokenMock2.address)).sglAssetID).to.be.eq(sglTokenMock2Asset);

        // Already registered
        await expect(tOLP.registerSingularity(sglTokenMock.address, sglTokenMockAsset)).to.revertedWith(
            'TapiocaOptions: already registered',
        );
    });

    it('should unregister a singularity', async () => {
        const { users, tOLP, sglTokenMock, sglTokenMockAsset, sglTokenMock2, sglTokenMock2Asset } = await loadFixture(setupFixture);
        await tOLP.registerSingularity(sglTokenMock.address, sglTokenMockAsset);
        await tOLP.registerSingularity(sglTokenMock2.address, sglTokenMock2Asset);
        expect(await tOLP.getSingularities()).to.be.deep.eq([sglTokenMockAsset, sglTokenMock2Asset]);

        // Only owner can unregister a singularity
        await expect(tOLP.connect(users[0]).registerSingularity(sglTokenMock.address, sglTokenMockAsset)).to.be.revertedWith(
            'Ownable: caller is not the owner',
        );

        // Unregister a singularity
        await expect(tOLP.unregisterSingularity(sglTokenMock.address))
            .to.emit(tOLP, 'UnregisterSingularity')
            .withArgs(sglTokenMock.address, sglTokenMockAsset);

        expect(await tOLP.getSingularities()).to.be.deep.eq([sglTokenMock2Asset]);

        await expect(tOLP.unregisterSingularity(sglTokenMock2.address))
            .to.emit(tOLP, 'UnregisterSingularity')
            .withArgs(sglTokenMock2.address, sglTokenMock2Asset);

        expect((await tOLP.activeSingularities(sglTokenMock.address)).sglAssetID).to.be.eq(0);
        expect((await tOLP.activeSingularities(sglTokenMock2.address)).sglAssetID).to.be.eq(0);

        // Not registered
        await expect(tOLP.unregisterSingularity(sglTokenMock.address)).to.revertedWith('TapiocaOptions: not registered');
    });

    it('should create a lock', async () => {
        const { signer, tOLP, yieldBox, sglTokenMock, sglTokenMockAsset, sglTokenMock2 } = await loadFixture(setupFixture);

        // Setup
        const lockDuration = 1;
        const lockAmount = 1e8;
        await tOLP.registerSingularity(sglTokenMock.address, sglTokenMockAsset);
        await sglTokenMock.freeMint(lockAmount);
        await sglTokenMock.approve(yieldBox.address, lockAmount);
        await yieldBox.depositAsset(sglTokenMockAsset, signer.address, signer.address, lockAmount, 0);
        await yieldBox.setApprovalForAll(tOLP.address, true);

        // Requirements
        await expect(tOLP.lock(signer.address, signer.address, sglTokenMock.address, 0, lockAmount)).to.revertedWith(
            'tOLP: lock duration must be > 0',
        );
        await expect(tOLP.lock(signer.address, signer.address, sglTokenMock.address, lockDuration, 0)).to.revertedWith(
            'tOLP: amount must be > 0',
        );
        await expect(tOLP.lock(signer.address, signer.address, sglTokenMock2.address, lockDuration, lockAmount)).to.revertedWith(
            'tOLP: singularity not active',
        );

        // Lock
        await expect(tOLP.lock(signer.address, signer.address, sglTokenMock.address, lockDuration, 1e8))
            .to.emit(tOLP, 'Mint')
            .withArgs(signer.address, sglTokenMockAsset, []);

        expect(await tOLP.tokenCounter()).to.be.eq(1);
        expect(await tOLP.ownerOf(0)).to.be.eq(signer.address);

        // Validate YieldBox transfers
        expect(await yieldBox.balanceOf(tOLP.address, sglTokenMockAsset)).to.be.eq(
            await yieldBox.toShare(sglTokenMockAsset, lockAmount, false),
        );

        // Validate position
        const lockPosition = await tOLP.lockPositions(0);
        expect(lockPosition.amount).to.be.eq(lockAmount);
        expect(lockPosition.lockDuration).to.be.eq(lockDuration);
        expect(lockPosition.lockTime).to.be.eq((await hre.ethers.provider.getBlock('latest')).timestamp);
        expect((await tOLP.activeSingularities(sglTokenMock.address)).totalDeposited).to.be.eq(lockAmount);
    });

    it('Should unlock a lock', async () => {
        const { signer, users, tOLP, yieldBox, sglTokenMock, sglTokenMockAsset, sglTokenMock2 } = await loadFixture(setupFixture);

        // Setup
        const lockDuration = 10;
        const lockAmount = 1e8;
        await tOLP.registerSingularity(sglTokenMock.address, sglTokenMockAsset);
        await sglTokenMock.freeMint(lockAmount);
        await sglTokenMock.approve(yieldBox.address, lockAmount);
        await yieldBox.depositAsset(sglTokenMockAsset, signer.address, signer.address, lockAmount, 0);
        await yieldBox.setApprovalForAll(tOLP.address, true);
        await tOLP.lock(signer.address, signer.address, sglTokenMock.address, lockDuration, 1e8);

        // Requirements
        await expect(tOLP.unlock(0, sglTokenMock.address, signer.address)).to.be.revertedWith('tOLP: Lock not expired');
        await time_travel(10);
        await expect(tOLP.unlock(0, sglTokenMock2.address, signer.address)).to.be.revertedWith('tOLP: Invalid singularity');
        await expect(tOLP.unlock(1, sglTokenMock.address, signer.address)).to.be.revertedWith('tOLP: Invalid singularity');
        await expect(tOLP.connect(users[0]).unlock(0, sglTokenMock.address, users[0].address)).to.be.revertedWith(
            'tOLP: not owner nor approved',
        );

        // Unlock
        await expect(tOLP.unlock(0, sglTokenMock.address, signer.address))
            .to.emit(tOLP, 'Burn')
            .withArgs(signer.address, sglTokenMockAsset, []);

        // Check cleanups
        await expect(tOLP.ownerOf(0)).to.be.revertedWith('ERC721: invalid token ID');
        const lockPosition = await tOLP.lockPositions(0);
        expect(lockPosition.amount).to.be.eq(0);
        expect(lockPosition.lockDuration).to.be.eq(0);
        expect(lockPosition.lockTime).to.be.eq(0);
        expect(lockPosition.lockDuration).to.be.eq(0);

        // Check balances
        expect(await yieldBox.balanceOf(signer.address, sglTokenMockAsset)).to.be.eq(
            await yieldBox.toShare(sglTokenMockAsset, lockAmount, false),
        );
        expect((await tOLP.activeSingularities(sglTokenMock.address)).totalDeposited).to.be.eq(0);
    });
});
