import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { useTranslation } from '@/i18n';
import { AppSettings } from '@/features/settings/settings.types';

export const useAutoSendEnterState = () => {
    const [autoSendEnter, setAutoSendEnter] = useState(false);
    const { t } = useTranslation();

    useEffect(() => {
        invoke<AppSettings>('get_all_settings')
            .then((settings) => {
                setAutoSendEnter(settings.auto_send_enter);
            })
            .catch((error) => {
                console.error('Failed to load auto send enter state:', error);
            });
    }, []);

    const handleSetAutoSendEnter = async (enabled: boolean) => {
        try {
            setAutoSendEnter(enabled);
            await invoke('set_auto_send_enter', { enabled });
        } catch (error) {
            console.error('Failed to set auto send enter:', error);
            toast.error(t('Failed to save auto-send Enter setting'));
            setAutoSendEnter(!enabled);
        }
    };

    return {
        autoSendEnter,
        setAutoSendEnter: handleSetAutoSendEnter,
    };
};
