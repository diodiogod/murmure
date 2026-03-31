import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'react-toastify';
import { useTranslation } from '@/i18n';

const AUTOMATIC_MIC_ID = 'automatic';

export interface MicInfo {
    id: string;
    label: string;
    isDisconnected?: boolean;
}

export const useMicState = () => {
    const { t } = useTranslation();
    const automaticLabel = t('Automatic');
    const systemDefaultLabel = t('System Default');
    const disconnectedLabel = t('Disconnected');
    const activeMicFallbackLabel = `${systemDefaultLabel} (${automaticLabel})`;

    const [micList, setMicList] = useState<MicInfo[]>([
        { id: AUTOMATIC_MIC_ID, label: automaticLabel },
    ]);
    const [currentMic, setCurrentMic] = useState(AUTOMATIC_MIC_ID);
    const [isLoading, setIsLoading] = useState(false);
    const [isFallbackToAutomatic, setIsFallbackToAutomatic] = useState(false);
    const [preferredMicLabel, setPreferredMicLabel] = useState('');
    const [currentMicLabel, setCurrentMicLabel] = useState<string | null>(null);

    const currentMicRef = useRef(currentMic);
    const isRefreshingRef = useRef(false);
    const lastKnownLabel = useRef<string | null>(null);
    const hasInitializedRefreshRef = useRef(false);
    const lastFallbackMicIdRef = useRef<string | null>(null);

    useEffect(() => {
        currentMicRef.current = currentMic;
    }, [currentMic]);

    const getPreferredMicLabel = useCallback(
        (micId: string) => {
            if (micId === AUTOMATIC_MIC_ID) {
                return automaticLabel;
            }

            if (currentMicRef.current === micId && currentMicLabel !== null) {
                return currentMicLabel;
            }

            if (lastKnownLabel.current !== null && currentMicRef.current === micId) {
                return lastKnownLabel.current;
            }

            return micId;
        },
        [automaticLabel, currentMicLabel]
    );

    const buildMicList = useCallback((devices: MicInfo[], selectedMicId: string) => {
        const currentDevice = devices.find((d) => d.id === selectedMicId);

        if (currentDevice) {
            lastKnownLabel.current = currentDevice.label;
            if (selectedMicId === currentMicRef.current) {
                setCurrentMicLabel(currentDevice.label);
            }
        }

        const newList: MicInfo[] = [{ id: AUTOMATIC_MIC_ID, label: automaticLabel }, ...devices];

        if (selectedMicId !== AUTOMATIC_MIC_ID && !currentDevice) {
            const friendlyName = getPreferredMicLabel(selectedMicId);
            newList.push({
                id: selectedMicId,
                label: `${friendlyName} (${disconnectedLabel})`,
                isDisconnected: true,
            });
        }

        return newList;
    }, [automaticLabel, currentMicLabel, disconnectedLabel, getPreferredMicLabel]);

    const addMicIfMissing = useCallback((micId: string, micLabel: string) => {
        setMicList((prev) => {
            if (prev.some((m) => m.id === micId)) {
                return prev;
            }
            return [...prev, { id: micId, label: micLabel }];
        });
    }, []);

    useEffect(() => {
        const loadCurrent = async () => {
            try {
                const [id, label] = await Promise.all([
                    invoke<string | null>('get_current_mic_id'),
                    invoke<string | null>('get_current_mic_label'),
                ]);
                const micId = id || AUTOMATIC_MIC_ID;
                setCurrentMic(micId);

                if (label) {
                    lastKnownLabel.current = label;
                    setCurrentMicLabel(label);
                }

                if (micId !== AUTOMATIC_MIC_ID) {
                    addMicIfMissing(micId, label ?? micId);
                }
            } catch (error) {
                console.error('Failed to load current mic', error);
            }
        };
        loadCurrent();
    }, [addMicIfMissing]);

    const refreshMicList = useCallback(async (showLoading: boolean = false) => {
        if (isRefreshingRef.current) {
            return;
        }
        isRefreshingRef.current = true;
        if (showLoading) {
            setIsLoading(true);
        }
        try {
            const devices = await invoke<MicInfo[]>('get_mic_list');
            const selectedMic = currentMicRef.current;
            const fallbackActive =
                selectedMic !== AUTOMATIC_MIC_ID &&
                devices.every((device) => device.id !== selectedMic);
            const preferredLabel = fallbackActive ? getPreferredMicLabel(selectedMic) : '';

            setMicList(buildMicList(devices, selectedMic));
            setIsFallbackToAutomatic(fallbackActive);
            setPreferredMicLabel(preferredLabel);

            if (hasInitializedRefreshRef.current) {
                if (fallbackActive && lastFallbackMicIdRef.current !== selectedMic) {
                    toast.warning(
                        t('{{mic}} is unavailable. Switched to {{activeMic}}.', {
                            mic: preferredLabel,
                            activeMic: activeMicFallbackLabel,
                        }),
                        { autoClose: 2500 }
                    );
                }

                if (!fallbackActive && lastFallbackMicIdRef.current !== null) {
                    toast.success(
                        t('{{mic}} is available again.', {
                            mic: getPreferredMicLabel(lastFallbackMicIdRef.current),
                        }),
                        { autoClose: 1800 }
                    );
                }
            }

            lastFallbackMicIdRef.current = fallbackActive ? selectedMic : null;
            hasInitializedRefreshRef.current = true;
        } catch (error) {
            console.error('Failed to load mic list', error);
        } finally {
            isRefreshingRef.current = false;
            if (showLoading) {
                setIsLoading(false);
            }
        }
    }, [activeMicFallbackLabel, buildMicList, getPreferredMicLabel, t]);

    useEffect(() => {
        const timer = setTimeout(() => void refreshMicList(false), 50);
        return () => clearTimeout(timer);
    }, [automaticLabel, currentMic, refreshMicList]);

    useEffect(() => {
        const handleFocus = () => {
            void refreshMicList(false);
        };

        window.addEventListener('focus', handleFocus);
        return () => {
            window.removeEventListener('focus', handleFocus);
        };
    }, [refreshMicList]);

    const setMic = async (id: string) => {
        const mic = micList.find((m) => m.id === id);
        const label = mic && id !== AUTOMATIC_MIC_ID ? mic.label : null;
        if (label) {
            lastKnownLabel.current = label;
            setCurrentMicLabel(label);
        }
        setCurrentMic(id);
        setIsFallbackToAutomatic(false);
        setPreferredMicLabel('');
        try {
            await invoke('set_current_mic_id', {
                micId: id === AUTOMATIC_MIC_ID ? null : id,
                micLabel: label,
            });
        } catch (error) {
            console.error('Failed to save microphone selection', error);
            toast.error(t('Failed to save microphone selection'));
        }
    };

    return {
        micList,
        currentMic,
        setMic,
        isLoading,
        refreshMicList,
        isFallbackToAutomatic,
        preferredMicLabel,
        activeMicFallbackLabel,
    };
};
