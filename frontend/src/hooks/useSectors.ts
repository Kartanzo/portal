import { useState, useEffect } from 'react';
import { api } from '../app_api';
import { SECTORS as FALLBACK_SECTORS } from '../constants';

let cachedSectors: string[] | null = null;

export function useSectors() {
    const [sectors, setSectors] = useState<string[]>(cachedSectors || FALLBACK_SECTORS);

    useEffect(() => {
        if (cachedSectors) {
            setSectors(cachedSectors);
            return;
        }
        api.getSectors().then(data => {
            const names = data.map((s: any) => s.name);
            cachedSectors = names;
            setSectors(names);
        }).catch(() => {
            setSectors(FALLBACK_SECTORS);
        });
    }, []);

    return sectors;
}

export function invalidateSectorsCache() {
    cachedSectors = null;
}
