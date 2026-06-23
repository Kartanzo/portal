import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useNotification } from '../contexts/NotificationContext';
import { useToast } from '../contexts/ToastContext';
import { X, Bell, Mail, Monitor, Volume2 } from 'lucide-react';

interface NotificationSettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

const NotificationSettings: React.FC<NotificationSettingsProps> = ({ isOpen, onClose }) => {
    const { preferences, updatePreferences } = useNotification();
    const { showToast } = useToast();
    const [localPrefs, setLocalPrefs] = useState(preferences);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setLocalPrefs(preferences);
    }, [preferences, isOpen]);

    if (!isOpen) return null;

    const handleSave = async () => {
        setSaving(true);
        try {
            await updatePreferences(localPrefs);
            onClose();
        } catch (error) {
            console.error(error);
            showToast('Erro ao salvar preferências', 'error');
        } finally {
            setSaving(false);
        }
    };

    return ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
            <div className="bg-white rounded-lg w-full max-w-md p-6 shadow-xl transform transition-all">
                <div className="flex justify-between items-center mb-6 border-b pb-4">
                    <h2 className="text-xl font-semibold text-gray-800 flex items-center">
                        <Bell className="w-5 h-5 mr-2 text-red-600" />
                        Configurar Notificações
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="space-y-6">
                    {/* Email */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center">
                            <div className="p-2 bg-blue-100 text-blue-600 rounded-full mr-4">
                                <Mail className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="font-medium text-gray-900">Email</p>
                                <p className="text-sm text-gray-500">Receber atualizações por email</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`text-xs font-bold uppercase mr-2 ${localPrefs.email ? 'text-green-600' : 'text-gray-400'}`}>
                                {localPrefs.email ? 'ON' : 'OFF'}
                            </span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={!!localPrefs.email}
                                    onChange={e => setLocalPrefs({ ...localPrefs, email: e.target.checked })}
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                            </label>
                        </div>
                    </div>

                    {/* Sound */}
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center">
                            <div className="p-2 bg-green-100 text-green-600 rounded-full mr-4">
                                <Volume2 className="w-5 h-5" />
                            </div>
                            <div>
                                <p className="font-medium text-gray-900">Alerta Sonoro</p>
                                <p className="text-sm text-gray-500">Tocar som ao receber notificações</p>

                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <span className={`text-xs font-bold uppercase mr-2 ${localPrefs.sound ? 'text-green-600' : 'text-gray-400'}`}>
                                {localPrefs.sound ? 'ON' : 'OFF'}
                            </span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={!!localPrefs.sound}
                                    onChange={e => setLocalPrefs({ ...localPrefs, sound: e.target.checked })}
                                />
                                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                            </label>
                        </div>
                    </div>


                </div>

                <div className="mt-8 flex justify-end space-x-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                        disabled={saving}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50 flex items-center"
                        disabled={saving}
                    >
                        {saving ? 'Salvando...' : 'Salvar Preferências'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default NotificationSettings;
