import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface Option {
    id: string;
    name: string;
    sector: string;
}

interface MultiSelectDropdownProps {
    options: Option[];
    selected: string[];
    onChange: (selected: string[]) => void;
    placeholder?: string;
    label: string;
}

export const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
    options,
    selected,
    onChange,
    placeholder = "Selecione...",
    label
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleToggle = (name: string) => {
        if (selected.includes(name)) {
            onChange(selected.filter(s => s !== name));
        } else {
            onChange([...selected, name]);
        }
    };

    const handleRemove = (name: string, e: React.MouseEvent) => {
        e.stopPropagation();
        onChange(selected.filter(s => s !== name));
    };

    const displayText = selected.length > 0
        ? `${selected.length} selecionado${selected.length > 1 ? 's' : ''}`
        : placeholder;

    return (
        <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                {label}
            </label>

            <div ref={dropdownRef} className="relative">
                {/* Dropdown Button */}
                <button
                    type="button"
                    onClick={() => setIsOpen(!isOpen)}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-left flex items-center justify-between outline-none focus:ring-2 focus:ring-red-600 transition-all"
                >
                    <span className={selected.length === 0 ? 'text-slate-400' : 'text-slate-700'}>
                        {displayText}
                    </span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Selected Tags */}
                {selected.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {selected.map(name => (
                            <div
                                key={name}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-lg text-xs font-semibold"
                            >
                                <span>{name}</span>
                                <button
                                    type="button"
                                    onClick={(e) => handleRemove(name, e)}
                                    className="hover:bg-red-200 rounded-full p-0.5"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Dropdown Menu */}
                {isOpen && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                        {options.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-400 italic">
                                Nenhum usuário encontrado
                            </div>
                        ) : (
                            <div className="py-1">
                                {options.map(option => (
                                    <label
                                        key={option.id}
                                        className="flex items-center px-4 py-2 hover:bg-slate-50 cursor-pointer transition-colors"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={selected.includes(option.name)}
                                            onChange={() => handleToggle(option.name)}
                                            className="w-4 h-4 text-red-600 rounded focus:ring-red-500 border-gray-300"
                                        />
                                        <span className="ml-3 text-sm font-semibold text-slate-700">
                                            {option.name} {option.sector && <span className="text-slate-400">({option.sector})</span>}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
