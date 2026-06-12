import React, { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Settings, X, Minus, Plus, HelpCircle, MousePointer2, MousePointerClick } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

function App() {
  const [volume, setVolume] = useState(50);
  const [isMuted, setIsMuted] = useState(false);
  const [activeView, setActiveView] = useState('osd'); // 'osd', 'settings', 'help'
  const [step, setStep] = useState(2);
  const [isHovered, setIsHovered] = useState(false);

  const barRef = useRef(null);

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
        toggleView('settings');
      });
      window.electronAPI.onForceOSD(() => {
        setActiveView('osd');
      });
    }
  }, []);

  const handleVolumeChange = (clientX) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const width = rect.width;
    let offsetX = clientX - rect.left;
    offsetX = Math.max(0, Math.min(width, offsetX));
    const newVolume = Math.round((offsetX / width) * 100);

    setVolume(newVolume);
    if (window.electronAPI) {
      window.electronAPI.setVolume(newVolume);
    }
  };

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // 左クリックのみ

    if (isMuted) {
      setIsMuted(false);
      if (window.electronAPI) {
        window.electronAPI.setMute(false);
      }
    }

    handleVolumeChange(e.clientX);
  };

  const toggleView = (viewName) => {
    setActiveView(viewName);
    if (window.electronAPI) {
      if (viewName !== 'osd') {
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
        {activeView === 'osd' && (
          <motion.div
            key="osd"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            className="bg-black/80 backdrop-blur-xl border border-white/20 w-[300px] h-20 rounded-2xl p-4 flex items-center gap-4 shadow-[0_0_30px_rgba(0,0,0,0.5)] relative group"
            onMouseEnter={() => {
              setIsHovered(true);
              if (window.electronAPI) window.electronAPI.setHover(true);
            }}
            onMouseLeave={() => {
              setIsHovered(false);
              if (window.electronAPI) window.electronAPI.setHover(false);
            }}
          >
            <div className={`p-2 rounded-xl shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-colors ${isMuted ? 'bg-red-500' : 'bg-indigo-500'}`}>
              {isMuted ? <VolumeX size={24} /> : <Volume2 size={24} />}
            </div>

            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-end gap-3">
                <span className={`text-[10px] font-black tracking-[0.2em] ${isMuted ? 'text-red-500' : 'text-indigo-400'}`}>
                  {isMuted ? 'MUTED' : 'Volume App'}
                </span>
                <span className={`text-2xl font-black tabular-nums transition-colors inline-block w-16 text-right ${isMuted ? 'text-red-500' : 'text-white'}`}>
                  {isMuted ? 'OFF' : `${volume}%`}
                </span>
              </div>

              {/* クリックを受け取るための、高さを持たせた親コンテナ */}
              <div
                ref={barRef}
                onMouseDown={handleMouseDown}
                className="w-full h-5 flex items-center cursor-pointer group/slider"
              >
                {/* トラック（背景の細いバー） */}
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden transition-colors group-hover/slider:bg-white/20">
                  {/* 進捗バー */}
                  <div
                    className={`h-full rounded-full ${
                      isMuted
                        ? 'bg-red-500/50'
                        : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'
                    }`}
                    style={{ width: isMuted ? '0%' : `${volume}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="absolute top-0 right-2 flex gap-0.5">
              <button
                onClick={() => toggleView('help')}
                className="p-1 text-white/30 hover:text-white"
                title="使い方"
              >
                <HelpCircle size={14} />
              </button>
              <button
                onClick={() => toggleView('settings')}
                className="p-1 text-white/30 hover:text-white"
                title="設定"
              >
                <Settings size={14} />
              </button>
            </div>
          </motion.div>
        )}

        {activeView === 'settings' && (
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
              <button onClick={() => toggleView('osd')} className="p-2 hover:bg-white/10 rounded-full transition-colors">
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

        {activeView === 'help' && (
          <motion.div
            key="help"
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="bg-black/90 backdrop-blur-2xl border border-white/20 w-full rounded-2xl p-5 flex flex-col gap-6 shadow-2xl"
          >
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                <HelpCircle size={20} className="text-indigo-400" />
                HOW TO USE
              </h2>
              <button onClick={() => toggleView('osd')} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-6">
              <div className="flex gap-4 items-start">
                <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                  <MousePointer2 size={24} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white/80">音量調整</h3>
                  <p className="text-[11px] text-white/40 mt-1">タスクバーの上でマウスホイールを回転するか、音量バーをクリックして調整できます。</p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="p-2 bg-purple-500/20 rounded-lg text-purple-400">
                  <MousePointerClick size={24} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white/80">ミュート切り替え</h3>
                  <p className="text-[11px] text-white/40 mt-1">タスクバーの上でマウスホイールをクリック（中クリック）するとミュートを切り替えます。</p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="p-2 bg-pink-500/20 rounded-lg text-pink-400">
                  <Settings size={24} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-white/80">ステップ数の変更</h3>
                  <p className="text-[11px] text-white/40 mt-1">設定画面から、一度の操作で変化する音量の幅（1%〜10%）を変更できます。</p>
                </div>
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
