import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';

interface SearchableSelectProps {
    options: string[];
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    fullWidth?: boolean;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
    options,
    value,
    onChange,
    placeholder = "Selecionar...",
    className = "",
    fullWidth = true
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    const filteredOptions = options.filter(option =>
        option.toLowerCase().includes(searchTerm.toLowerCase())
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (option: string) => {
        onChange(option);
        setIsOpen(false);
        setSearchTerm("");
    };

    return (
        <div className={`relative ${fullWidth ? 'w-full' : ''} ${className}`} ref={containerRef}>
            <div
                onClick={() => setIsOpen(!isOpen)}
                className="w-full bg-slate-50 border-none rounded-xl text-xs font-bold text-slate-700 py-3 pl-4 pr-10 cursor-pointer transition-all hover:bg-slate-100 flex items-center justify-between min-h-[44px]"
            >
                <span className={!value || value === 'Todos' ? "text-slate-400" : ""}>
                    {value === 'Todos' ? placeholder : (value || placeholder)}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <div className="absolute z-50 w-full mt-2 bg-white rounded-xl shadow-2xl border border-slate-100 overflow-hidden">
                    <div className="p-2 border-b border-slate-50 flex items-center gap-2 bg-slate-50/50">
                        <Search className="w-3.5 h-3.5 text-slate-400 ml-1" />
                        <input
                            autoFocus
                            type="text"
                            placeholder="Pesquisar..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full bg-transparent border-none text-xs font-bold text-slate-700 outline-none p-1"
                            onClick={(e) => e.stopPropagation()}
                        />
                        {searchTerm && (
                            <X
                                className="w-3.5 h-3.5 text-slate-400 cursor-pointer hover:text-slate-600 mr-1"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setSearchTerm("");
                                }}
                            />
                        )}
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option, index) => (
                                <div
                                    key={index}
                                    onClick={() => handleSelect(option)}
                                    className={`px-4 py-2.5 text-xs font-bold cursor-pointer transition-colors ${value === option
                                        ? 'bg-red-50 text-red-600'
                                        : 'text-slate-600 hover:bg-slate-50 hover:text-red-600'
                                        }`}
                                >
                                    {option}
                                </div>
                            ))
                        ) : (
                            <div className="px-4 py-4 text-xs font-medium text-slate-400 text-center italic">
                                Nenhum resultado encontrado
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
