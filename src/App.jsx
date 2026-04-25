import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX, Settings, X, Minus, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function App() {
  const [volume, setVolume] = useState(50);
  const [isMuted, setIsMuted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [step, setStep] = useState(2);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getVolume().then(v => setVolume(Math.round(v)));
      window.electronAPI.getMute().then(m => setIsMuted(m));
      window.electronAPI.getSettings().then(s => setStep(s.step || 2));
      
      window.electronAPI.onVolumeUpdated((newVolume) => {
        setVolume(newVolume);
        setIsMuted(false);
      });

      window.electronAPI.onMuteUpdated((muteState) => {
        setIsMuted(muteState);
      });

      window.electronAPI.onOpenSettings(() => {
        setShowSettings(true);
      });
    }
  }, []);

  const toggleSettings = (state) => {
    setShowSettings(state);
    if (window.electronAPI) {
      if (state) {
        window.electronAPI.resizeWindow(320, 500);
      } else {
        window.electronAPI.resizeWindow(320, 120);
      }
    }
  };

  const updateStep = (newStep) => {
    const s = Math.max(1, Math.min(10, newStep));
    setStep(s);
    if (window.electronAPI) {
      window.electronAPI.setSetting('step', s);
    }
  };

  return (
    <div className="w-full h-full p-2 flex flex-col items-center justify-center select-none overflow-hidden font-sans text-white">
      <AnimatePresence mode="wait">
        {!showSettings ? (
          <motion.div 
            key="osd"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            className="bg-black/80 backdrop-blur-xl border border-white/20 w-full h-20 rounded-2xl p-4 flex items-center gap-4 shadow-[0_0_30px_rgba(0,0,0,0.5)] relative group"
          >
            <div className={`p-2 rounded-xl shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-colors ${isMuted ? 'bg-red-500' : 'bg-indigo-500'}`}>
              {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
            </div>
            
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex justify-between items-end">
                <span className={`text-[10px] font-black tracking-[0.2em] ${isMuted ? 'text-red-500' : 'text-indigo-400'}`}>
                  {isMuted ? 'MUTED' : 'SYSTEM VOLUME'}
                </span>
                <span className={`text-2xl font-black tabular-nums transition-colors ${isMuted ? 'text-red-500' : 'text-white'}`}>
                  {isMuted ? 'OFF' : `${volume}%`}
                </span>
              </div>
              
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div 
                  className={`h-full transition-colors ${isMuted ? 'bg-red-500/50' : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'}`}
                  initial={false}
                  animate={{ width: isMuted ? '0%' : `${volume}%` }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              </div>
            </div>

            <button 
              onClick={() => toggleSettings(true)}
              className="absolute top-1 right-1 p-1 opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-white"
            >
              <Settings size={14} />
            </button>
          </motion.div>
        ) : (
          <motion.div 
            key="settings"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="bg-black/90 backdrop-blur-2xl border border-white/20 w-full rounded-2xl p-5 flex flex-col gap-6 shadow-2xl"
          >
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                <Settings size={20} className="text-indigo-400" />
                SETTINGS
              </h2>
              <button onClick={() => toggleSettings(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-white/40 tracking-widest uppercase">Volume Step Size</label>
                <div className="flex items-center gap-4 bg-white/5 p-3 rounded-xl border border-white/10">
                  <button 
                    onClick={() => updateStep(step - 1)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-indigo-400"
                  >
                    <Minus size={20} />
                  </button>
                  <div className="flex-1 text-center">
                    <span className="text-3xl font-black tabular-nums">{step}</span>
                    <span className="text-xs text-white/40 ml-1">%</span>
                  </div>
                  <button 
                    onClick={() => updateStep(step + 1)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-indigo-400"
                  >
                    <Plus size={20} />
                  </button>
                </div>
                <p className="text-[10px] text-white/30 italic">Determines how much the volume changes per scroll/keypress.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 text-[10px] text-center text-white/20">
              VOLUME APP • V1.0.0
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
