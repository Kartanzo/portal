import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, ChevronDown } from 'lucide-react';

interface DateRange {
    start: Date;
    end: Date;
}

interface DateRangePickerProps {
    range: DateRange;
    onChange: (range: DateRange) => void;
    onClose: () => void;
}

const DateRangePicker: React.FC<DateRangePickerProps> = ({ range, onChange, onClose }) => {
    const [tempRange, setTempRange] = useState<DateRange>(range);
    const [currentDate, setCurrentDate] = useState(new Date(range.start || new Date()));
    const [showPresetDropdown, setShowPresetDropdown] = useState(false);

    useEffect(() => {
        setTempRange(range);
    }, [range]);

    const getDaysInMonth = (year: number, month: number) => {
        return new Date(year, month + 1, 0).getDate();
    };

    const formatMonthYear = (date: Date) => {
        return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
    };

    const navigateMonth = (direction: 'prev' | 'next') => {
        const newDate = new Date(currentDate);
        newDate.setMonth(currentDate.getMonth() + (direction === 'next' ? 1 : -1));
        setCurrentDate(newDate);
    };

    const handleDayClick = (day: number) => {
        const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
        clickedDate.setHours(0, 0, 0, 0);

        const isSingleDayRange = tempRange.start.getTime() === tempRange.end.getTime();

        if (!isSingleDayRange) {
            setTempRange({ start: clickedDate, end: clickedDate });
        } else {
            if (clickedDate < tempRange.start) {
                setTempRange({ start: clickedDate, end: tempRange.start });
            } else {
                setTempRange({ start: tempRange.start, end: clickedDate });
            }
        }
    };

    const isInRange = (date: Date) => {
        return date > tempRange.start && date < tempRange.end;
    };

    const isStart = (date: Date) => {
        return date.getTime() === tempRange.start.getTime();
    }

    const isEnd = (date: Date) => {
        return date.getTime() === tempRange.end.getTime();
    }

    const handleApply = () => {
        onChange(tempRange);
        onClose();
    };

    const presets = [
        { label: 'Hoje', getValue: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return { start: d, end: d }; } },
        { label: 'Ontem', getValue: () => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(0, 0, 0, 0); return { start: d, end: d }; } },
        {
            label: 'Este mês', getValue: () => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth(), 1);
                const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                return { start, end };
            }
        },
        {
            label: 'Mês passado', getValue: () => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const end = new Date(now.getFullYear(), now.getMonth(), 0);
                return { start, end };
            }
        },
        {
            label: 'Últimos 7 dias', getValue: () => {
                const end = new Date(); end.setHours(0, 0, 0, 0);
                const start = new Date(end); start.setDate(end.getDate() - 6);
                return { start, end };
            }
        },
        {
            label: 'Últimos 30 dias', getValue: () => {
                const end = new Date(); end.setHours(0, 0, 0, 0);
                const start = new Date(end); start.setDate(end.getDate() - 29);
                return { start, end };
            }
        },
        {
            label: '3 meses', getValue: () => {
                const start = new Date(); start.setHours(0, 0, 0, 0);
                const end = new Date(start); end.setMonth(start.getMonth() + 3);
                return { start, end };
            }
        },
        {
            label: '6 meses', getValue: () => {
                const start = new Date(); start.setHours(0, 0, 0, 0);
                const end = new Date(start); end.setMonth(start.getMonth() + 6);
                return { start, end };
            }
        },
    ];

    const activePreset = presets.find(p => {
        const val = p.getValue();
        return tempRange.start.getTime() === val.start.getTime() && tempRange.end.getTime() === val.end.getTime();
    });

    const renderMonth = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const daysInMonth = getDaysInMonth(year, month);
        const firstDayOfWeek = new Date(year, month, 1).getDay();

        const days = [];

        for (let i = 0; i < firstDayOfWeek; i++) {
            days.push(<div key={`empty-${i}`} className="w-8 h-8"></div>);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const date = new Date(year, month, i);
            date.setHours(0, 0, 0, 0);

            const isS = isStart(date);
            const isE = isEnd(date);
            const inR = isInRange(date);

            let className = "w-8 h-8 flex items-center justify-center text-xs font-bold cursor-pointer rounded-full transition-all relative z-10 ";

            if (isS && isE) {
                className += "bg-red-600 text-white";
            } else if (isS) {
                className += "bg-red-600 text-white rounded-r-none";
            } else if (isE) {
                className += "bg-red-600 text-white rounded-l-none";
            } else if (inR) {
                className += "bg-red-50 text-red-600 rounded-none";
            } else {
                className += "text-gray-700 hover:bg-gray-100";
            }

            days.push(
                <div key={i} className="relative p-0.5">
                    {(inR || isS && !isE || isE && !isS) && (
                        <div className={`absolute top-0.5 bottom-0.5 ${isS ? 'left-[50%] right-0' : isE ? 'left-0 right-[50%]' : 'left-0 right-0'} bg-red-50 z-0`}></div>
                    )}
                    <div
                        onClick={() => handleDayClick(i)}
                        className={className}
                    >
                        {i}
                    </div>
                </div>
            );
        }

        return (
            <div className="w-[280px]">
                <div className="flex items-center justify-between mb-3">
                    <button onClick={() => navigateMonth('prev')} className="p-1 hover:bg-gray-100 rounded-full text-gray-500">
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-black uppercase text-gray-700">{formatMonthYear(currentDate)}</span>
                    <button onClick={() => navigateMonth('next')} className="p-1 hover:bg-gray-100 rounded-full text-gray-500">
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
                <div className="grid grid-cols-7 mb-2">
                    {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, idx) => (
                        <div key={`${d}-${idx}`} className="text-center text-[9px] font-black text-gray-400">{d}</div>
                    ))}
                </div>
                <div className="grid grid-cols-7 gap-y-0.5">
                    {days}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden animate-in fade-in zoom-in-95 origin-top-right absolute top-full right-0 mt-2 z-50">
            <div className="p-4">
                {/* Preset Dropdown */}
                <div className="mb-4 relative">
                    <button
                        onClick={() => setShowPresetDropdown(!showPresetDropdown)}
                        className="w-full flex items-center justify-between px-3 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:border-red-400 transition-colors bg-white"
                    >
                        <span>{activePreset?.label || 'Período personalizado'}</span>
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                    </button>

                    {showPresetDropdown && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowPresetDropdown(false)}></div>
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
                                {presets.map((preset, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => {
                                            setTempRange(preset.getValue());
                                            setShowPresetDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs font-semibold transition-all hover:bg-red-50 hover:text-red-600"
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>

                {/* Single Calendar */}
                <div className="flex justify-center">
                    {renderMonth()}
                </div>
            </div>

            {/* Footer */}
            <div className="border-t border-gray-100 p-3 flex justify-end items-center gap-2 bg-gray-50/50">
                <button
                    onClick={onClose}
                    className="px-4 py-1.5 text-xs font-bold text-gray-600 hover:text-gray-800 transition-colors"
                >
                    Cancelar
                </button>
                <button
                    onClick={handleApply}
                    className="px-4 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-red-700 transition-colors"
                >
                    Aplicar Filtro
                </button>
            </div>
        </div>
    );
};

export default DateRangePicker;
