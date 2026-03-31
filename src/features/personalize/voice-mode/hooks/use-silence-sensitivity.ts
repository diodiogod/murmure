import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useSilenceSensitivity = () => {
    const [silenceSensitivity, setSilenceSensitivity] = useState(5);

    useEffect(() => {
        invoke<number>('get_silence_sensitivity')
            .then(setSilenceSensitivity)
            .catch((err) => console.error('Failed to load silence sensitivity:', err));
    }, []);

    const updateSilenceSensitivity = async (value: number) => {
        try {
            await invoke('set_silence_sensitivity', {
                value,
            });
            setSilenceSensitivity(value);
        } catch (err) {
            console.error('Failed to set silence sensitivity:', err);
        }
    };

    return {
        silenceSensitivity,
        setSilenceSensitivity: updateSilenceSensitivity,
    };
};
