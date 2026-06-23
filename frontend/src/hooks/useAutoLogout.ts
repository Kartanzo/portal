import { useEffect, useRef, useCallback } from 'react';
import { User } from '../types';

const TIMEOUT_DURATION = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
const CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds
const ACTIVITY_KEY = 'last_activity_time';

export const useAutoLogout = (
    user: User | null,
    onLogout: () => void,
    customTimeout?: number
) => {
    const timeoutDuration = customTimeout || TIMEOUT_DURATION;
    const checkIntervalRef = useRef<NodeJS.Timeout | null>(null);

    const updateActivity = useCallback(() => {
        sessionStorage.setItem(ACTIVITY_KEY, Date.now().toString());
    }, []);

    const checkInactivity = useCallback(() => {
        const lastActivity = sessionStorage.getItem(ACTIVITY_KEY);
        if (!lastActivity) {
            updateActivity();
            return;
        }

        const timeSinceActivity = Date.now() - parseInt(lastActivity, 10);

        if (timeSinceActivity > timeoutDuration) {
            console.log('Auto-logout: Session timeout due to inactivity');
            onLogout();
        }
    }, [timeoutDuration, onLogout, updateActivity]);

    useEffect(() => {
        if (!user) {
            // Clear interval if user logs out
            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
                checkIntervalRef.current = null;
            }
            sessionStorage.removeItem(ACTIVITY_KEY);
            return;
        }

        // Initialize last activity on login
        updateActivity();

        // Activity event listeners
        const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];

        events.forEach(event => {
            window.addEventListener(event, updateActivity);
        });

        // Set up periodic inactivity check
        checkIntervalRef.current = setInterval(checkInactivity, CHECK_INTERVAL);

        return () => {
            events.forEach(event => {
                window.removeEventListener(event, updateActivity);
            });

            if (checkIntervalRef.current) {
                clearInterval(checkIntervalRef.current);
                checkIntervalRef.current = null;
            }
        };
    }, [user, updateActivity, checkInactivity]);
};
