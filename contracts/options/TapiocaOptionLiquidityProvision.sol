// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol';
import '@boringcrypto/boring-solidity/contracts/BoringOwnable.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/security/Pausable.sol';
import '../interfaces/IYieldBox.sol';

//
//                 .(%%%%%%%%%%%%*       *
//             #%%%%%%%%%%%%%%%%%%%%*  ####*
//          #%%%%%%%%%%%%%%%%%%%%%#  /####
//       ,%%%%%%%%%%%%%%%%%%%%%%%   ####.  %
//                                #####
//                              #####
//   #####%#####              *####*  ####%#####*
//  (#########(              #####     ##########.
//  ##########             #####.      .##########
//                       ,####/
//                      #####
//  %%%%%%%%%%        (####.           *%%%%%%%%%#
//  .%%%%%%%%%%     *####(            .%%%%%%%%%%
//   *%%%%%%%%%%   #####             #%%%%%%%%%%
//               (####.
//      ,((((  ,####(          /(((((((((((((
//        *,  #####  ,(((((((((((((((((((((
//          (####   ((((((((((((((((((((/
//         ####*  (((((((((((((((((((
//                     ,**//*,.

struct LockPosition {
    uint128 sglAssetID; // Singularity market YieldBox asset ID
    uint128 amount; // amount of tOLR tokens locked.
    uint128 lockTime; // time when the tokens were locked
    uint128 lockDuration; // duration of the lock
}

struct SingularityPool {
    uint256 sglAssetID; // Singularity market YieldBox asset ID
    uint256 totalDeposited; // total amount of tOLR tokens deposited, used for pool share calculation
}

contract TapiocaOptionLiquidityProvision is ERC721, Pausable, BoringOwnable {
    uint256 public tokenCounter; // Counter for token IDs
    mapping(uint256 => LockPosition) public lockPositions; // TokenID => LockPosition

    IYieldBox public immutable yieldBox;

    // Singularity market address => SingularityPool (YieldBox Asset ID is 0 if not active)
    mapping(IERC20 => SingularityPool) public activeSingularities;
    uint256[] public singularities; // Array of active singularity asset IDs

    constructor(address _yieldBox) ERC721('TapiocaOptionLiquidityProvision', 'tOLP') {
        yieldBox = IYieldBox(_yieldBox);
    }

    // ==========
    //   EVENTS
    // ==========
    event Mint(address indexed to, uint128 indexed sglAssetID, LockPosition lockPosition);
    event Burn(address indexed to, uint128 indexed sglAssetID, LockPosition lockPosition);
    event RegisterSingularity(address sgl, uint256 assetID);
    event UnregisterSingularity(address sgl, uint256 assetID);

    // =========
    //    READ
    // =========

    function isApprovedOrOwner(address _spender, uint256 _tokenId) external view returns (bool) {
        return _isApprovedOrOwner(_spender, _tokenId);
    }

    /// @notice Returns the total amount of locked tokens for a given singularity market
    function getTotalPoolWeight(uint256 _sglAssetId) external view returns (uint256) {
        return yieldBox.totalSupply(_sglAssetId);
    }

    /// @notice Returns the lock position of a given tOLP NFT and if it's active
    /// @param _tokenId tOLP NFT ID
    function getLock(uint256 _tokenId) external view returns (bool, LockPosition memory) {
        LockPosition memory lockPosition = lockPositions[_tokenId];

        return (_isPositionActive(_tokenId), lockPosition);
    }

    /// @notice Returns the active singularity markets
    function getSingularities() external view returns (uint256[] memory) {
        return singularities;
    }

    // ==========
    //    WRITE
    // ==========

    /// @notice Locks tOLR tokens for a given duration
    /// @param _from Address to transfer the SGL tokens from
    /// @param _to Address to mint the tOLP NFT to
    /// @param _singularity Singularity market address
    /// @param _lockDuration Duration of the lock
    /// @param _amount Amount of tOLR tokens to lock
    /// @return tokenId The ID of the minted NFT
    function lock(
        address _from,
        address _to,
        IERC20 _singularity,
        uint128 _lockDuration,
        uint128 _amount
    ) external returns (uint256 tokenId) {
        require(_lockDuration > 0, 'tOLP: lock duration must be > 0');
        require(_amount > 0, 'tOLP: amount must be > 0');

        uint256 sglAssetID = activeSingularities[_singularity].sglAssetID;
        require(sglAssetID > 0, 'tOLP: singularity not active');

        // Transfer the Singularity position to this contract
        uint256 sharesIn = yieldBox.toShare(sglAssetID, _amount, false);

        yieldBox.transfer(_from, address(this), sglAssetID, sharesIn);
        activeSingularities[_singularity].totalDeposited += _amount;

        // Mint the tOLP NFT position
        tokenId = tokenCounter++;
        _safeMint(_to, tokenId);

        // Create the lock position
        LockPosition storage lockPosition = lockPositions[tokenId];
        lockPosition.lockTime = uint128(block.timestamp);
        lockPosition.sglAssetID = uint128(sglAssetID);
        lockPosition.lockDuration = _lockDuration;
        lockPosition.amount = _amount;

        emit Mint(_to, uint128(sglAssetID), lockPosition);
    }

    /// @notice Unlocks tOLP tokens
    /// @param _tokenId ID of the position to unlock
    /// @param _singularity Singularity market address
    /// @param _to Address to send the tokens to
    function unlock(
        uint256 _tokenId,
        IERC20 _singularity,
        address _to
    ) external returns (uint256 sharesOut) {
        LockPosition memory lockPosition = lockPositions[_tokenId];
        require(block.timestamp >= lockPosition.lockTime + lockPosition.lockDuration, 'tOLP: Lock not expired');
        require(activeSingularities[_singularity].sglAssetID == lockPosition.sglAssetID, 'tOLP: Invalid singularity');

        require(_isApprovedOrOwner(msg.sender, _tokenId), 'tOLP: not owner nor approved');

        _burn(_tokenId);
        delete lockPositions[_tokenId];

        // Transfer the tOLR tokens back to the owner
        sharesOut = yieldBox.toShare(lockPosition.sglAssetID, lockPosition.amount, false);

        yieldBox.transfer(address(this), _to, lockPosition.sglAssetID, sharesOut);
        activeSingularities[_singularity].totalDeposited -= lockPosition.amount;

        emit Burn(_to, lockPosition.sglAssetID, lockPosition);
    }

    // =========
    //  INTERNAL
    // =========

    /// @notice Checks if the lock position is still active
    function _isPositionActive(uint256 tokenId) internal view returns (bool) {
        LockPosition memory lockPosition = lockPositions[tokenId];

        return (lockPosition.lockTime + lockPosition.lockDuration) >= block.timestamp;
    }

    /// @notice ERC1155 compliance
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure returns (bytes4) {
        return bytes4(keccak256('onERC1155Received(address,address,uint256,uint256,bytes)'));
    }

    // =========
    //   OWNER
    // =========
    function registerSingularity(IERC20 singularity, uint256 assetID) external onlyOwner {
        require(activeSingularities[singularity].sglAssetID == 0, 'TapiocaOptions: already registered');

        activeSingularities[singularity].sglAssetID = assetID;
        singularities.push(assetID);

        emit RegisterSingularity(address(singularity), assetID);
    }

    function unregisterSingularity(IERC20 singularity) external onlyOwner {
        uint256 sglAssetID = activeSingularities[singularity].sglAssetID;
        require(sglAssetID > 0, 'TapiocaOptions: not registered');

        unchecked {
            uint256[] memory _singularities = singularities;
            uint256 sglLength = _singularities.length;
            uint256 sglLastIndex = sglLength - 1;

            for (uint256 i = 0; i < sglLength; i++) {
                // If in the middle, delete data and move last element to the deleted position, then pop
                if (_singularities[i] == sglAssetID && i < sglLastIndex) {
                    delete activeSingularities[singularity];
                    delete singularities[i];

                    singularities[i] = _singularities[sglLastIndex];
                    singularities.pop();

                    break;
                } else {
                    // If last element, just pop
                    delete activeSingularities[singularity];
                    delete singularities[sglLastIndex];
                    singularities.pop();
                }
            }
        }

        emit UnregisterSingularity(address(singularity), sglAssetID);
    }
}
