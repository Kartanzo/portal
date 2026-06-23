import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MonthYearPickerProps {
    selectedDate: Date;
    onChange: (date: Date) => void;
    onClose: () => void;
}

const MonthYearPicker: React.FC<MonthYearPickerProps> = ({ selectedDate, onChange, onClose }) => {
    const [viewYear, setViewYear] = useState(selectedDate.getFullYear());

    const months = [
        "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
        "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
    ];

    const handleMonthClick = (monthIndex: number) => {
        const newDate = new Date(viewYear, monthIndex, 1);
        onChange(newDate);
        onClose();
    };

    return (
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-[280px] animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between mb-4">
                <button
                    onClick={() => setViewYear(viewYear - 1)}
                    className="p-1 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
                <span className="text-lg font-bold text-gray-800">{viewYear}</span>
                <button
                    onClick={() => setViewYear(viewYear + 1)}
                    className="p-1 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
                {months.map((month, index) => {
                    const isSelected = selectedDate.getMonth() === index && selectedDate.getFullYear() === viewYear;
                    return (
                        <button
                            key={month}
                            onClick={() => handleMonthClick(index)}
                            className={`py-2 px-1 text-xs font-bold rounded-lg transition-all ${isSelected
                                ? 'bg-red-600 text-white shadow-md'
                                : 'text-gray-600 hover:bg-red-50 hover:text-red-600'
                                }`}
                        >
                            {month.substring(0, 3).toUpperCase()}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default MonthYearPicker;
