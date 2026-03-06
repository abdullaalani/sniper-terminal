import React, { useState } from 'react';
import { saveEncryptedKeys, getDecryptedKeys, clearKeys } from '../services/crypto';

interface BinanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  isConnected: boolean;
  onConnectionChanged: (connected: boolean) => void;
  onKeysDecrypted?: (keys: {apiKey: string, apiSecret: string}) => void;
}

const BinanceModal: React.FC<BinanceModalProps> = ({ isOpen, onClose, isConnected, onConnectionChanged, onKeysDecrypted }) => {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSave = () => {
    setError(null);
    if (!apiKey || !apiSecret || !password) {
      setError("All fields are required.");
      return;
    }

    const success = saveEncryptedKeys(apiKey, apiSecret, password);
    if (success) {
      onConnectionChanged(true);
      // Automatically unlock for this session since user just entered info
      if (onKeysDecrypted) onKeysDecrypted({ apiKey, apiSecret });
      
      onClose();
      setApiKey('');
      setApiSecret('');
      setPassword('');
    } else {
      setError("Failed to save keys.");
    }
  };

  const handleUnlock = () => {
    setError(null);
    if (!password) {
       setError("Password required to unlock.");
       return;
    }
    const keys = getDecryptedKeys(password);
    if (keys) {
      if (onKeysDecrypted) onKeysDecrypted(keys);
      onClose();
      setPassword('');
    } else {
      setError("Incorrect password.");
    }
  }

  const handleDisconnect = () => {
    setError(null);
    if (!password) {
      setError("Enter password to confirm deletion.");
      return;
    }

    const keys = getDecryptedKeys(password);
    if (keys) {
      clearKeys();
      onConnectionChanged(false);
      onClose();
      setPassword('');
    } else {
      setError("Incorrect password. Cannot delete keys.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg shadow-2xl w-96 overflow-hidden animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="bg-[#0d1117] px-6 py-4 border-b border-[#30363d] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[#FCD535]" viewBox="0 0 24 24" fill="currentColor">
               <path d="M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0106l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6355-2.7175-2.7155 7.353-7.3288z"></path>
            </svg>
            <h2 className="text-white font-bold text-sm tracking-wide">BINANCE CONNECT</h2>
          </div>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          
          {error && (
            <div className="bg-[#da3633]/10 border border-[#da3633] text-[#da3633] px-3 py-2 rounded text-xs">
              {error}
            </div>
          )}

          {!isConnected ? (
            <>
              {/* Setup New Keys Form */}
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#8b949e]">API Key</label>
                <input 
                  type="text" 
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-white text-xs font-mono focus:border-[#FCD535] focus:outline-none transition-colors"
                  placeholder="Paste your Binance API Key"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-bold text-[#8b949e]">Secret Key</label>
                <input 
                  type="password" 
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-white text-xs font-mono focus:border-[#FCD535] focus:outline-none transition-colors"
                  placeholder="Paste your Binance Secret Key"
                />
              </div>
              <div className="space-y-1 pt-2 border-t border-[#30363d]">
                <label className="text-[10px] uppercase font-bold text-[#58a6ff]">Encryption Password</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#58a6ff] rounded p-2 text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#58a6ff]"
                  placeholder="Set a password to secure these keys"
                />
              </div>
              <button 
                onClick={handleSave}
                className="w-full mt-4 py-2 bg-[#FCD535] hover:bg-[#ffe066] text-black font-bold text-xs rounded transition-colors"
              >
                ENCRYPT & SAVE KEYS
              </button>
            </>
          ) : (
            <>
              {/* Unlock / Disconnect Form */}
              <div className="text-center py-4 space-y-2">
                <div className="w-12 h-12 bg-[#238636]/20 text-[#238636] rounded-full flex items-center justify-center mx-auto">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <h3 className="text-white font-bold">Keys Locked</h3>
                <p className="text-xs text-[#8b949e] px-4">Enter password to unlock for trading or delete keys.</p>
              </div>

              <div className="space-y-1 pt-4 border-t border-[#30363d]">
                <label className="text-[10px] uppercase font-bold text-white">Password</label>
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded p-2 text-white text-xs font-mono focus:outline-none focus:border-[#58a6ff]"
                  placeholder="Enter Password"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-2 mt-2">
                 <button 
                  onClick={handleUnlock}
                  className="py-2 bg-[#238636] hover:bg-[#2ea043] text-white font-bold text-xs rounded transition-all"
                >
                  UNLOCK TRADING
                </button>
                <button 
                  onClick={handleDisconnect}
                  className="py-2 bg-[#21262d] border border-[#30363d] hover:border-[#da3633] hover:text-[#da3633] text-[#8b949e] font-bold text-xs rounded transition-all"
                >
                  DELETE KEYS
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
};

export default BinanceModal;