import { EChainID } from '@tapioca-sdk/api/config';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Multicall3 } from 'tapioca-sdk/dist/typechain/tapioca-periphery';
import { DEPLOYMENT_NAMES, DEPLOY_CONFIG } from 'tasks/deploy/DEPLOY_CONFIG';

export const buildPostLbpStackPostDepSetup = async (
    hre: HardhatRuntimeEnvironment,
    tag: string,
): Promise<Multicall3.CallStruct[]> => {
    const calls: Multicall3.CallStruct[] = [];

    /**
     * Load contracts
     */
    const { adb, tapToken, tapOracleDeployment, usdcOracleDeployment, aoTap } =
        await loadContract(hre, tag);

    /**
     * Broker claim for AOTAP
     */
    if ((await aoTap.broker()) !== adb.address) {
        console.log('[+] +Call queue: AOTAP broker claim');
        calls.push({
            target: adb.address,
            allowFailure: false,
            callData: adb.interface.encodeFunctionData('aoTAPBrokerClaim'),
        });
    }

    /**
     * Set tapToken in ADB
     */
    if (
        (await adb.tapToken()).toLocaleLowerCase() !==
        tapToken.address.toLocaleLowerCase()
    ) {
        console.log('[+] +Call queue: set TapToken in AirdropBroker');
        calls.push({
            target: adb.address,
            allowFailure: false,
            callData: adb.interface.encodeFunctionData('setTapToken', [
                tapToken.address,
            ]),
        });
        console.log('\t- Parameters:', 'TapToken', tapToken.address);
    }

    /**
     * Set Tap oracle in ADB
     */
    if (
        (await adb.tapToken()).toLocaleLowerCase() !==
        tapOracleDeployment.address.toLocaleLowerCase()
    ) {
        console.log('[+] +Call queue: set TapToken in AirdropBroker');
        calls.push({
            target: adb.address,
            allowFailure: false,
            callData: adb.interface.encodeFunctionData('setTapOracle', [
                tapOracleDeployment.address,
                '0x00',
            ]),
        });
    }

    /**
     * Set USDC as payment token in ADB
     */
    const usdcAddr =
        DEPLOY_CONFIG.POST_LBP[EChainID.ARBITRUM].ADB.USDC_PAYMENT_TOKEN;
    if (
        (await adb.paymentTokens(usdcAddr)).oracle.toLocaleLowerCase() !==
        usdcAddr.toLocaleLowerCase()
    ) {
        console.log(
            '[+] +Call queue: set USDC as payment token in AirdropBroker',
        );
        calls.push({
            target: adb.address,
            allowFailure: false,
            callData: adb.interface.encodeFunctionData('setPaymentToken', [
                usdcAddr,
                usdcOracleDeployment.address,
                '0x00',
            ]),
        });
        console.log(
            '\t- Parameters:',
            'USDC',
            usdcAddr,
            'USDC Oracle',
            usdcOracleDeployment.address,
            'Oracle Data',
            '0x00',
        );
    }

    /**
     * AirDropBroker new epoch
     */
    if ((await adb.epoch()).toNumber() == 0) {
        console.log('[+] +Call queue: AirdropBroker going to epoch 1');
        calls.push({
            target: adb.address,
            allowFailure: false,
            callData: adb.interface.encodeFunctionData('newEpoch'),
        });
    }

    return calls;
};

async function loadContract(hre: HardhatRuntimeEnvironment, tag: string) {
    const tapOracleDeployment = getContract(
        hre,
        tag,
        DEPLOYMENT_NAMES.TAP_ORACLE,
    );

    const usdcOracleDeployment = getContract(hre, tag, 'USDC_ORACLE'); // TODO load the name from the SDK and centralize each repo config in the SDK

    const tapToken = await hre.ethers.getContractAt(
        'TapToken',
        getContract(hre, tag, DEPLOYMENT_NAMES.TAP_TOKEN).address,
    );
    const adb = await hre.ethers.getContractAt(
        'AirdropBroker',
        getContract(hre, tag, DEPLOYMENT_NAMES.AIRDROP_BROKER).address,
    );
    const aoTap = await hre.ethers.getContractAt(
        'AOTAP',
        getContract(hre, tag, DEPLOYMENT_NAMES.AOTAP).address,
    );

    return {
        tapToken,
        adb,
        tapOracleDeployment,
        usdcOracleDeployment,
        aoTap,
    };
}

function getContract(
    hre: HardhatRuntimeEnvironment,
    tag: string,
    contractName: string,
) {
    const contract = hre.SDK.db.findLocalDeployment(
        String(hre.network.config.chainId),
        contractName,
        tag,
    )!;
    if (!contract) {
        throw new Error(
            `[-] ${contractName} not found on chain ${hre.network.name} tag ${tag}`,
        );
    }
    return contract;
}
