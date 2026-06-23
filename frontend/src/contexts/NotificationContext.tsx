import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../app_api';
import { Notification as NotificationType, NotificationPreferences, User } from '../types';

interface NotificationContextType {
    notifications: NotificationType[];
    unreadCount: number;
    preferences: NotificationPreferences;
    markAsRead: (id: string) => Promise<void>;
    updatePreferences: (prefs: NotificationPreferences) => Promise<void>;
    refresh: () => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

// Web Audio API Beep Helper
// Reuses a single AudioContext to avoid Chrome autoplay warning
let audioCtx: AudioContext | null = null;

// Rate-limit: bipa no maximo 1x a cada 60s, mesmo se o estado disparar varias vezes
let lastBeepAt = 0;
const BEEP_MIN_INTERVAL_MS = 60_000;

const playBeep = () => {
    try {
        // Rate-limit antes de tudo: nao toca duas vezes em janela curta
        const now = Date.now();
        if (now - lastBeepAt < BEEP_MIN_INTERVAL_MS) return;
        lastBeepAt = now;

        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;

        if (!audioCtx) {
            audioCtx = new AudioContextClass();
        }

        // Only play if context is running (i.e., user has interacted with the page)
        if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => { });
            return; // Don't play yet — will play on next trigger after resume
        }

        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = 880; // A5
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        // Silently ignore — audio is non-critical
    }
};

export const NotificationProvider: React.FC<{ children: React.ReactNode; user: User | null }> = ({ children, user }) => {
    const [notifications, setNotifications] = useState<NotificationType[]>([]);
    const [preferences, setPreferences] = useState<NotificationPreferences>({ email: true, sound: true, desktop: true });
    const [unreadCount, setUnreadCount] = useState(0);
    const lastUnreadCountRef = useRef(0);

    // No need for audioRef with Web Audio API

    const fetchNotifications = useCallback(async () => {
        if (!user) return;
        try {
            const list = await api.getNotifications(user.id);
            setNotifications(list);

            const unread = list.filter(n => !n.is_read).length;
            setUnreadCount(unread);

            // Check for new notifications to alert
            if (unread > lastUnreadCountRef.current) {
                // Trigger Alerts
                triggerAlerts(preferences);
            }
            lastUnreadCountRef.current = unread;
        } catch (e) {
            console.error("Failed to fetch notifications", e);
        }
    }, [user, preferences]);

    const triggerAlerts = (prefs: NotificationPreferences) => {
        // Sound
        if (prefs.sound) {
            playBeep();
        }
        // Desktop
        if (prefs.desktop && "Notification" in window) {
            const options = {
                body: "Você tem novas notificações!",
                requireInteraction: true, // Make it stick until user reads
                tag: 'portal-notifications', // Prevent stacking (overwrites previous)
                renotify: true // Play sound/vibrate again even if tag matches
            };

            if (Notification.permission === "granted") {
                new Notification("Portal de Chamados", options);
            } else if (Notification.permission !== "denied") {
                Notification.requestPermission().then(permission => {
                    if (permission === "granted") {
                        new Notification("Portal de Chamados", options);
                    }
                });
            }
        }
    };

    useEffect(() => {
        // Only update from user prop if it's a different user or if we don't have preferences yet.
        // This prevents overwriting locally updated preferences with stale user data from parent.
        if (user && user.notification_preferences) {
            setPreferences(prev => {
                // specific check: if user id changed, allows reset.
                // Ideally we'd compare IDs, but here we can just trust the user prop for initial load.
                // A simple way is to check if the incoming prefs are different from what we expect,
                // but really we just want to avoid the "stale overwrite".
                // Best fix: Only set if we are initializing or switching users.
                // For now, let's just ignore if we have local state, unless user ID changed?
                // But we don't track previous user ID.
                return user.notification_preferences;
            });
        }
    }, [user?.id]); // Only run when user ID changes (or login/logout)

    // Polling
    useEffect(() => {
        if (!user) return;

        fetchNotifications(); // Initial
        const interval = setInterval(fetchNotifications, 30000); // 30s
        return () => clearInterval(interval);
    }, [user, fetchNotifications]);

    const markAsRead = async (id: string) => {
        try {
            await api.markNotificationRead(id);
            // Optimistic update
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
            setUnreadCount(prev => Math.max(0, prev - 1));
            lastUnreadCountRef.current = Math.max(0, lastUnreadCountRef.current - 1);
        } catch (e) {
            console.error("Mark read error", e);
        }
    };

    const updatePreferences = async (newPrefs: NotificationPreferences) => {
        if (!user) return;
        try {
            await api.updateNotificationPreferences(user.id, newPrefs);
            setPreferences(newPrefs);
        } catch (e) {
            console.error("Update prefs error", e);
            throw e;
        }
    };

    return (
        <NotificationContext.Provider value={{ notifications, unreadCount, preferences, markAsRead, updatePreferences, refresh: fetchNotifications }}>
            {children}
        </NotificationContext.Provider>
    );
};

export const useNotification = () => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification must be used within a NotificationProvider');
    }
    return context;
};
