import React, { useState, useEffect, useRef } from 'react';
import { Palette, X, Check } from 'lucide-react';

const THEMES = [
  { id: 'emerald', name: 'Emerald', label: 'Default' },
  { id: 'sapphire', name: 'Sapphire', label: 'Blue' },
  { id: 'citrine', name: 'Citrine', label: 'Amber' },
  { id: 'amethyst', name: 'Amethyst', label: 'Purple' },
  { id: 'ruby', name: 'Ruby', label: 'Rose' },
  { id: 'obsidian', name: 'Obsidian', label: 'Slate' },
  { id: 'aqua', name: 'Aqua', label: 'Cyan' },
  { id: 'coral', name: 'Coral', label: 'Orange' },
  { id: 'malachite', name: 'Malachite', label: 'Teal' },
  { id: 'pearl', name: 'Pearl', label: 'Zinc' },
];

export default function ThemeSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState('emerald');
  const modalRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem('fds_theme') || 'emerald';
    setCurrentTheme(saved);
    if (saved !== 'emerald') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectTheme = (themeId) => {
    setCurrentTheme(themeId);
    localStorage.setItem('fds_theme', themeId);
    if (themeId === 'emerald') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', themeId);
    }
    setIsOpen(false);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="w-full flex items-center justify-center gap-2 p-2 rounded-xl text-xs font-bold text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors border border-transparent hover:border-gray-200"
      >
        <Palette size={14} />
        Theme Settings
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-gray-900/40 z-[60] flex items-center justify-center p-4">
          <div 
            ref={modalRef}
            className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-sm overflow-hidden animate-in fade-in zoom-in-95 duration-200"
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div className="flex items-center gap-2 text-gray-800 font-bold">
                <Palette size={18} className="text-primary-500" />
                Select Theme
              </div>
              <button 
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-200 rounded-lg text-gray-500 transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            
            <div className="p-4 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                {THEMES.map((theme) => {
                  const isActive = currentTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => handleSelectTheme(theme.id)}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        isActive 
                          ? 'border-primary-500 bg-primary-50 shadow-sm' 
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full mb-1">
                        <span className={`font-black text-sm ${isActive ? 'text-primary-700' : 'text-gray-800'}`}>
                          {theme.name}
                        </span>
                        {isActive && <Check size={14} className="text-primary-600" />}
                      </div>
                      <span className={`text-[10px] uppercase tracking-wider font-bold ${isActive ? 'text-primary-500' : 'text-gray-400'}`}>
                        {theme.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
