import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';

export const useStopOnSilence = () => {
    const [stopOnSilence, setStopOnSilence] = useState(true);

    useEffect(() => {
        invoke<boolean>('get_stop_on_silence_after_wake_word')
            .then(setStopOnSilence)
            .catch((err) => console.error('Failed to load stop on silence setting:', err));
    }, []);

    const updateStopOnSilence = async (value: boolean) => {
        try {
            await invoke('set_stop_on_silence_after_wake_word', {
                enabled: value,
            });
            setStopOnSilence(value);
        } catch (err) {
            console.error('Failed to set stop on silence:', err);
        }
    };

    return { stopOnSilence, setStopOnSilence: updateStopOnSilence };
};
