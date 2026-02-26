import { useState, useEffect } from 'react';

/**
 * A custom hook that provides a "tick" every minute.
 * Designed to synchronize multiple components (like countdown timers) 
 * to a single global heart-beat, reducing resource usage and ensuring sync.
 * 
 * @returns The current timestamp (Date) updated every minute.
 */
export function useMinuteTick(): Date {
    const [now, setNow] = useState(new Date());

    useEffect(() => {
        // Calculate milliseconds to the next full minute to align the heartbeat
        const msUntilNextMinute = 60000 - (Date.now() % 60000);

        let interval: NodeJS.Timeout;

        const timeout = setTimeout(() => {
            // First update at the turn of the minute
            setNow(new Date());

            // Then start the interval
            interval = setInterval(() => {
                setNow(new Date());
            }, 60000);
        }, msUntilNextMinute);

        return () => {
            clearTimeout(timeout);
            if (interval) clearInterval(interval);
        };
    }, []);

    return now;
}
