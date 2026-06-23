import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { MAX_FILE_SIZE_MB } from '../constants';

interface FileSizeWarningModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const FileSizeWarningModal: React.FC<FileSizeWarningModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 bg-yellow-100 p-3 rounded-full">
                            <AlertTriangle className="w-6 h-6 text-yellow-600" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-lg font-bold text-gray-900 mb-2">Arquivo muito grande</h3>
                            <p className="text-sm text-gray-600 leading-relaxed font-medium">
                                O total dos arquivos excede o limite de <span className="font-bold">{MAX_FILE_SIZE_MB} MB</span>. Por favor, remova alguns arquivos ou anexe amostras menores.
                            </p>
                            <p className="text-sm text-gray-600 leading-relaxed mt-2">
                                Caso os arquivos sejam necessários para o desenvolvimento, crie uma pasta na rede e informe o caminho na descrição do chamado.
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-gray-500 transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="bg-gray-50 px-6 py-4 flex justify-end gap-3 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold text-white bg-yellow-600 rounded-lg hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500 transition-colors shadow-sm"
                    >
                        Entendi
                    </button>
                </div>
            </div>
        </div>
    );
};

export default FileSizeWarningModal;
