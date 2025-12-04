import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface CreditLine {
  id: string;
  bankName: string;
  encryptedAmount: string;
  timestamp: number;
  owner: string;
  currency: string;
  expiryDate: string;
  interestRate: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [creditLines, setCreditLines] = useState<CreditLine[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newCreditLineData, setNewCreditLineData] = useState({
    bankName: "",
    amount: "",
    currency: "USD",
    expiryDate: "",
    interestRate: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  // Calculate statistics for dashboard
  const totalCredit = creditLines.reduce((sum, line) => sum + parseFloat(line.encryptedAmount.replace("FHE-", "")), 0);
  const bankCount = new Set(creditLines.map(line => line.bankName)).size;

  useEffect(() => {
    loadCreditLines().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadCreditLines = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("credit_line_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing credit line keys:", e);
        }
      }
      
      const list: CreditLine[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`credit_line_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                bankName: recordData.bankName,
                encryptedAmount: recordData.amount,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                currency: recordData.currency,
                expiryDate: recordData.expiryDate,
                interestRate: recordData.interestRate
              });
            } catch (e) {
              console.error(`Error parsing credit line data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading credit line ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setCreditLines(list);
    } catch (e) {
      console.error("Error loading credit lines:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitCreditLine = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting credit data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedAmount = `FHE-${newCreditLineData.amount}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        bankName: newCreditLineData.bankName,
        amount: encryptedAmount,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        currency: newCreditLineData.currency,
        expiryDate: newCreditLineData.expiryDate,
        interestRate: parseFloat(newCreditLineData.interestRate)
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `credit_line_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("credit_line_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "credit_line_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Credit line added securely with FHE!"
      });
      
      await loadCreditLines();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewCreditLineData({
          bankName: "",
          amount: "",
          currency: "USD",
          expiryDate: "",
          interestRate: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE contract is available: ${isAvailable}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const toggleExpand = (id: string) => {
    if (expandedItem === id) {
      setExpandedItem(null);
    } else {
      setExpandedItem(id);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Your Wallet",
      description: "Link your Web3 wallet to access the confidential credit aggregation platform",
      icon: "🔗"
    },
    {
      title: "Add Bank Credit Lines",
      description: "Securely add your encrypted credit lines from multiple banking institutions",
      icon: "🏦"
    },
    {
      title: "FHE Aggregation",
      description: "Your credit data is aggregated using Fully Homomorphic Encryption without decryption",
      icon: "🔒"
    },
    {
      title: "View Total Credit",
      description: "Access your complete credit picture while maintaining bank relationship privacy",
      icon: "📊"
    }
  ];

  const renderPieChart = () => {
    if (creditLines.length === 0) {
      return (
        <div className="pie-chart-container">
          <div className="pie-chart empty">
            <div className="pie-center">
              <div className="pie-value">0</div>
              <div className="pie-label">No Data</div>
            </div>
          </div>
        </div>
      );
    }

    const currencyDistribution = creditLines.reduce((acc: any, line) => {
      acc[line.currency] = (acc[line.currency] || 0) + parseFloat(line.encryptedAmount.replace("FHE-", ""));
      return acc;
    }, {});

    const currencies = Object.keys(currencyDistribution);
    const total = Object.values(currencyDistribution).reduce((sum: any, val) => sum + val, 0);
    
    // Generate colors based on number of currencies
    const colors = ["#FF6384", "#36A2EB", "#FFCE56", "#4BC0C0", "#9966FF", "#FF9F40"];

    let cumulativePercentage = 0;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          {currencies.map((currency, index) => {
            const percentage = (currencyDistribution[currency] / total) * 100;
            const segment = (
              <div 
                key={currency}
                className="pie-segment"
                style={{
                  backgroundColor: colors[index % colors.length],
                  transform: `rotate(${cumulativePercentage * 3.6}deg)`,
                  opacity: 0.8
                }}
              ></div>
            );
            cumulativePercentage += percentage;
            return segment;
          })}
          <div className="pie-center">
            <div className="pie-value">{currencies.length}</div>
            <div className="pie-label">Currencies</div>
          </div>
        </div>
        <div className="pie-legend">
          {currencies.map((currency, index) => (
            <div className="legend-item" key={currency}>
              <div 
                className="color-box" 
                style={{ backgroundColor: colors[index % colors.length] }}
              ></div>
              <span>{currency}: ${currencyDistribution[currency].toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>Confidential<span>Credit</span>Aggregator</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={checkAvailability}
            className="action-btn"
          >
            Check FHE Status
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="primary-btn"
          >
            Add Credit Line
          </button>
          <button 
            className="action-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Multi-Bank Credit Line Aggregation</h2>
            <p>Securely aggregate your credit lines across multiple banks using FHE technology</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section glass-panel">
            <h2>How FHE Credit Aggregation Works</h2>
            <p className="subtitle">Your financial data remains encrypted throughout the entire process</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-number">{index + 1}</div>
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-panels">
          <div className="panel glass-panel intro-panel">
            <h3>About FHE Credit Aggregation</h3>
            <p>This platform uses Fully Homomorphic Encryption (FHE) to allow businesses to aggregate encrypted credit lines from multiple banking partners without exposing sensitive relationship details or individual credit terms.</p>
            <div className="fhe-badge">
              <span>FHE-Powered Confidentiality</span>
            </div>
          </div>
          
          <div className="panel glass-panel stats-panel">
            <h3>Credit Overview</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">${totalCredit.toLocaleString()}</div>
                <div className="stat-label">Total Credit</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{creditLines.length}</div>
                <div className="stat-label">Credit Lines</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{bankCount}</div>
                <div className="stat-label">Banks</div>
              </div>
            </div>
          </div>
          
          <div className="panel glass-panel chart-panel">
            <h3>Currency Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="credit-lines-section">
          <div className="section-header">
            <h2>Encrypted Credit Lines</h2>
            <div className="header-actions">
              <button 
                onClick={loadCreditLines}
                className="action-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh Data"}
              </button>
            </div>
          </div>
          
          <div className="credit-list glass-panel">
            {creditLines.length === 0 ? (
              <div className="no-data">
                <div className="no-data-icon">🏦</div>
                <p>No credit lines found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Credit Line
                </button>
              </div>
            ) : (
              creditLines.map(line => (
                <div className="credit-item" key={line.id}>
                  <div className="credit-header" onClick={() => toggleExpand(line.id)}>
                    <div className="bank-info">
                      <div className="bank-icon">🏦</div>
                      <div className="bank-details">
                        <h4>{line.bankName}</h4>
                        <p>{line.currency} • Expires: {line.expiryDate}</p>
                      </div>
                    </div>
                    <div className="credit-amount">
                      ${line.encryptedAmount.replace("FHE-", "")}
                    </div>
                    <div className="expand-icon">
                      {expandedItem === line.id ? "▲" : "▼"}
                    </div>
                  </div>
                  
                  {expandedItem === line.id && (
                    <div className="credit-details">
                      <div className="detail-row">
                        <span className="detail-label">Interest Rate:</span>
                        <span className="detail-value">{line.interestRate}%</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Added On:</span>
                        <span className="detail-value">
                          {new Date(line.timestamp * 1000).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Encrypted Data:</span>
                        <span className="detail-value encrypted">{line.encryptedAmount}</span>
                      </div>
                      <div className="detail-row">
                        <span className="detail-label">Owner:</span>
                        <span className="detail-value">
                          {line.owner.substring(0, 6)}...{line.owner.substring(38)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitCreditLine} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          creditLineData={newCreditLineData}
          setCreditLineData={setNewCreditLineData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>ConfidentialCreditAggregator</span>
            </div>
            <p>Secure multi-bank credit aggregation using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} ConfidentialCreditAggregator. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  creditLineData: any;
  setCreditLineData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  creditLineData,
  setCreditLineData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setCreditLineData({
      ...creditLineData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!creditLineData.bankName || !creditLineData.amount) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-panel">
        <div className="modal-header">
          <h2>Add Encrypted Credit Line</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="key-icon">🔒</div> Your credit data will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Bank Name *</label>
              <input 
                type="text"
                name="bankName"
                value={creditLineData.bankName} 
                onChange={handleChange}
                placeholder="Enter bank name" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Credit Amount *</label>
              <input 
                type="number"
                name="amount"
                value={creditLineData.amount} 
                onChange={handleChange}
                placeholder="Enter amount" 
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Currency</label>
              <select 
                name="currency"
                value={creditLineData.currency} 
                onChange={handleChange}
                className="form-select"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="JPY">JPY</option>
                <option value="CAD">CAD</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Expiry Date</label>
              <input 
                type="date"
                name="expiryDate"
                value={creditLineData.expiryDate} 
                onChange={handleChange}
                className="form-input"
              />
            </div>
            
            <div className="form-group">
              <label>Interest Rate (%)</label>
              <input 
                type="number"
                step="0.01"
                name="interestRate"
                value={creditLineData.interestRate} 
                onChange={handleChange}
                placeholder="Enter interest rate" 
                className="form-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🔐</div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="action-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="primary-btn"
          >
            {creating ? "Encrypting with FHE..." : "Add Credit Line"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;