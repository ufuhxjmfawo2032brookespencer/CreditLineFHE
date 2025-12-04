// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CreditLineFHE is SepoliaConfig {
    struct EncryptedCreditLine {
        uint256 lineId;
        address bankAddress;      // Bank identifier
        euint32 encryptedAmount;  // Encrypted credit amount
        euint32 encryptedUtilized; // Encrypted utilized amount
        uint256 timestamp;
        bool isActive;
    }

    struct AggregatedResult {
        uint32 totalAvailable;
        uint32 totalUtilized;
        bool isRevealed;
    }

    uint256 public lineCount;
    mapping(uint256 => EncryptedCreditLine) public encryptedLines;
    AggregatedResult public aggregatedResult;

    euint32 private encryptedTotalAvailable;
    euint32 private encryptedTotalUtilized;
    
    address public aggregator;
    address public enterprise;
    mapping(uint256 => uint256) private requestToAggregationId;

    event CreditLineAdded(uint256 indexed lineId, address indexed bank);
    event AggregationRequested();
    event AggregationCompleted(uint32 totalAvailable, uint32 totalUtilized);

    modifier onlyAggregator() {
        require(msg.sender == aggregator, "Caller not authorized");
        _;
    }

    modifier onlyEnterprise() {
        require(msg.sender == enterprise, "Enterprise only");
        _;
    }

    constructor(address _enterprise) {
        aggregator = msg.sender;
        enterprise = _enterprise;
        encryptedTotalAvailable = FHE.asEuint32(0);
        encryptedTotalUtilized = FHE.asEuint32(0);
    }

    /// @notice Add encrypted credit line from bank
    function addEncryptedCreditLine(
        address bankAddress,
        euint32 encryptedAmount,
        euint32 encryptedUtilized
    ) public onlyAggregator {
        lineCount += 1;
        uint256 newLineId = lineCount;

        encryptedLines[newLineId] = EncryptedCreditLine({
            lineId: newLineId,
            bankAddress: bankAddress,
            encryptedAmount: encryptedAmount,
            encryptedUtilized: encryptedUtilized,
            timestamp: block.timestamp,
            isActive: true
        });

        _updateAggregatedTotals(newLineId);
        emit CreditLineAdded(newLineId, bankAddress);
    }

    /// @notice Update aggregated totals with new line
    function _updateAggregatedTotals(uint256 lineId) private {
        EncryptedCreditLine storage line = encryptedLines[lineId];
        
        encryptedTotalAvailable = FHE.add(encryptedTotalAvailable, line.encryptedAmount);
        encryptedTotalUtilized = FHE.add(encryptedTotalUtilized, line.encryptedUtilized);
    }

    /// @notice Request aggregation result decryption
    function requestAggregation() public onlyEnterprise {
        require(!aggregatedResult.isRevealed, "Already revealed");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(encryptedTotalAvailable);
        ciphertexts[1] = FHE.toBytes32(encryptedTotalUtilized);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleAggregationResult.selector);
        requestToAggregationId[reqId] = 1; // Using 1 as aggregation ID

        emit AggregationRequested();
    }

    /// @notice Handle decrypted aggregation result
    function handleAggregationResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        require(requestToAggregationId[requestId] == 1, "Invalid request");
        require(!aggregatedResult.isRevealed, "Already revealed");

        FHE.checkSignatures(requestId, cleartexts, proof);
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));

        aggregatedResult = AggregatedResult({
            totalAvailable: results[0],
            totalUtilized: results[1],
            isRevealed: true
        });

        emit AggregationCompleted(results[0], results[1]);
    }

    /// @notice Get aggregation result
    function getAggregationResult() public view onlyEnterprise returns (
        uint32 totalAvailable,
        uint32 totalUtilized,
        bool isRevealed
    ) {
        return (
            aggregatedResult.totalAvailable,
            aggregatedResult.totalUtilized,
            aggregatedResult.isRevealed
        );
    }

    /// @notice Deactivate credit line (e.g. when revoked by bank)
    function deactivateCreditLine(uint256 lineId) public onlyAggregator {
        require(encryptedLines[lineId].isActive, "Line already inactive");
        
        EncryptedCreditLine storage line = encryptedLines[lineId];
        encryptedTotalAvailable = FHE.sub(encryptedTotalAvailable, line.encryptedAmount);
        encryptedTotalUtilized = FHE.sub(encryptedTotalUtilized, line.encryptedUtilized);
        line.isActive = false;
    }

    /// @notice Get credit line metadata (without amounts)
    function getCreditLineInfo(uint256 lineId) public view onlyEnterprise returns (
        address bankAddress,
        uint256 timestamp,
        bool isActive
    ) {
        EncryptedCreditLine storage line = encryptedLines[lineId];
        return (line.bankAddress, line.timestamp, line.isActive);
    }

    /// @notice Transfer enterprise ownership
    function transferEnterpriseOwnership(address newEnterprise) public onlyEnterprise {
        enterprise = newEnterprise;
    }
}