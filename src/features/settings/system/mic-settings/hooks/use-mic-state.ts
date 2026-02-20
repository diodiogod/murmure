import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from '@/i18n';
import { toast } from 'react-toastify';

const AUTOMATIC_MIC_ID = 'automatic';
const MIC_LABEL_CACHE_KEY = 'murmure.mic-label-cache.v1';

interface MicDevice {
    id: string;
    label: string;
    isDisconnected?: boolean;
}

function isLikelyTechnicalMicId(id: string): boolean {
    return (
        id.includes(':{') ||
        id.startsWith('wasapi:') ||
        id.startsWith('coreaudio:') ||
        id.startsWith('alsa:')
    );
}

function normalizeLabel(value: string): string {
    return value.trim().toLowerCase();
}

function loadMicLabelCache(): Record<string, string> {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        const raw = window.localStorage.getItem(MIC_LABEL_CACHE_KEY);
        if (raw == null || raw.length === 0) {
            return {};
        }

        const parsed: unknown = JSON.parse(raw);
        if (parsed == null || typeof parsed !== 'object') {
            return {};
        }

        const cache: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed)) {
            if (
                typeof key === 'string' &&
                key.length > 0 &&
                typeof value === 'string' &&
                value.length > 0
            ) {
                cache[key] = value;
            }
        }
        return cache;
    } catch {
        return {};
    }
}

function saveMicLabelCache(cache: Record<string, string>): void {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        window.localStorage.setItem(MIC_LABEL_CACHE_KEY, JSON.stringify(cache));
    } catch {
        // Ignore storage failures.
    }
}

export function useMicState() {
    const { t } = useTranslation();
    const automaticLabel = t('Automatic');
    const systemDefaultLabel = t('System Default');
    const disconnectedLabel = t('Disconnected');
    const genericMicLabel = t('Microphone');
    const activeMicFallbackLabel = `${systemDefaultLabel} (${automaticLabel})`;

    const [micList, setMicList] = useState<MicDevice[]>([
        { id: AUTOMATIC_MIC_ID, label: automaticLabel },
    ]);
    const [currentMic, setCurrentMic] = useState(AUTOMATIC_MIC_ID);
    const [isLoading, setIsLoading] = useState(false);
    const currentMicRef = useRef(currentMic);
    const isRefreshingRef = useRef(false);
    const knownMicLabelsRef = useRef<Record<string, string>>(loadMicLabelCache());
    const hasInitializedRefreshRef = useRef(false);
    const lastFallbackMicIdRef = useRef<string | null>(null);
    const [isFallbackToAutomatic, setIsFallbackToAutomatic] = useState(false);
    const [preferredMicLabel, setPreferredMicLabel] = useState('');

    useEffect(() => {
        currentMicRef.current = currentMic;
    }, [currentMic]);

    const rememberMicLabel = useCallback(
        (micId: string, label: string) => {
            if (micId === AUTOMATIC_MIC_ID || micId === 'default') {
                return;
            }

            const trimmed = label.trim();
            if (trimmed.length === 0) {
                return;
            }

            const disconnectedSuffix = ` (${disconnectedLabel})`;
            const baseLabel = trimmed.endsWith(disconnectedSuffix)
                ? trimmed.slice(0, -disconnectedSuffix.length).trim()
                : trimmed;

            if (baseLabel.length === 0) {
                return;
            }

            const current = knownMicLabelsRef.current[micId];
            const currentNormalized = current != null ? normalizeLabel(current) : '';
            const newNormalized = normalizeLabel(baseLabel);
            const genericNormalized = normalizeLabel(genericMicLabel);
            const currentIsGeneric = currentNormalized === genericNormalized;
            const newIsGeneric = newNormalized === genericNormalized;

            if (
                current != null &&
                current.length > 0 &&
                !currentIsGeneric &&
                newIsGeneric
            ) {
                return;
            }

            if (current === baseLabel) {
                return;
            }

            const nextCache = {
                ...knownMicLabelsRef.current,
                [micId]: baseLabel,
            };
            knownMicLabelsRef.current = nextCache;
            saveMicLabelCache(nextCache);
        },
        [disconnectedLabel, genericMicLabel]
    );

    const getPreferredMicBaseLabel = useCallback(
        (micId: string) => {
            if (micId === 'default') {
                return systemDefaultLabel;
            }

            const knownLabel = knownMicLabelsRef.current[micId];
            if (knownLabel != null && knownLabel.length > 0) {
                return knownLabel;
            }

            if (isLikelyTechnicalMicId(micId)) {
                return genericMicLabel;
            }

            return micId;
        },
        [genericMicLabel, systemDefaultLabel]
    );

    const getMissingMicLabel = useCallback(
        (micId: string) => {
            const baseLabel = getPreferredMicBaseLabel(micId);
            return `${baseLabel} (${disconnectedLabel})`;
        },
        [disconnectedLabel, getPreferredMicBaseLabel]
    );

    const refreshMicList = useCallback(
        async (showLoading: boolean = false) => {
            if (isRefreshingRef.current) {
                return;
            }
            isRefreshingRef.current = true;

            if (showLoading) {
                setIsLoading(true);
            }

            try {
                const devices = await invoke<MicDevice[]>('get_mic_list');
                for (const device of devices) {
                    rememberMicLabel(device.id, device.label);
                }

                const selectedMic = currentMicRef.current;
                const isCurrentMicFound = devices.some(
                    (device) => device.id === selectedMic
                );
                const fallbackActive =
                    selectedMic !== AUTOMATIC_MIC_ID && !isCurrentMicFound;
                const selectedMicBaseLabel =
                    getPreferredMicBaseLabel(selectedMic);

                setMicList((_) => {
                    const newList: MicDevice[] = [
                        { id: AUTOMATIC_MIC_ID, label: automaticLabel },
                        ...devices.map((device) => ({
                            id: device.id,
                            label: device.label,
                        })),
                    ];

                    // Keep selected mic visible even if it's temporarily missing/disconnected.
                    if (
                        selectedMic !== AUTOMATIC_MIC_ID &&
                        !isCurrentMicFound
                    ) {
                        const missingLabel = getMissingMicLabel(selectedMic);
                        newList.push({
                            id: selectedMic,
                            label: missingLabel,
                            isDisconnected: true,
                        });
                    }

                    return newList;
                });

                setIsFallbackToAutomatic(fallbackActive);
                setPreferredMicLabel(fallbackActive ? selectedMicBaseLabel : '');

                if (hasInitializedRefreshRef.current) {
                    if (
                        fallbackActive &&
                        lastFallbackMicIdRef.current !== selectedMic
                    ) {
                        toast.warning(
                            t('{{mic}} is unavailable. Switched to {{activeMic}}.', {
                                mic: selectedMicBaseLabel,
                                activeMic: activeMicFallbackLabel,
                            }),
                            { autoClose: 2500 }
                        );
                    }

                    if (
                        !fallbackActive &&
                        lastFallbackMicIdRef.current != null
                    ) {
                        const restoredMicLabel = getPreferredMicBaseLabel(
                            lastFallbackMicIdRef.current
                        );
                        toast.success(t('{{mic}} is available again.', {
                            mic: restoredMicLabel,
                        }), { autoClose: 1800 });
                    }
                }

                lastFallbackMicIdRef.current = fallbackActive
                    ? selectedMic
                    : null;
                hasInitializedRefreshRef.current = true;
            } catch (error) {
                console.error('Failed to load mic list', error);
            } finally {
                if (showLoading) {
                    setIsLoading(false);
                }
                isRefreshingRef.current = false;
            }
        },
        [
            activeMicFallbackLabel,
            automaticLabel,
            getMissingMicLabel,
            getPreferredMicBaseLabel,
            rememberMicLabel,
            t,
        ]
    );

    useEffect(() => {
        async function loadCurrent() {
            try {
                const id = await invoke<string | null>('get_current_mic_id');
                const micId = id ?? AUTOMATIC_MIC_ID;
                setCurrentMic(micId);

                if (micId !== AUTOMATIC_MIC_ID) {
                    setMicList((prev) => {
                        for (const m of prev) {
                            if (m.id === micId) return prev;
                        }
                        const label = getMissingMicLabel(micId);
                        return [
                            ...prev,
                            { id: micId, label, isDisconnected: true },
                        ];
                    });
                }
            } catch (error) {
                console.error('Failed to load current mic', error);
            }
        }
        loadCurrent();
    }, [getMissingMicLabel]);

    useEffect(() => {
        function handleWindowFocus() {
            void refreshMicList();
        }

        void refreshMicList(true);
        window.addEventListener('focus', handleWindowFocus);

        return () => {
            window.removeEventListener('focus', handleWindowFocus);
        };
    }, [refreshMicList]);

    async function setMic(id: string) {
        setCurrentMic(id);

        const selectedDevice = micList.find((mic) => mic.id === id);
        if (selectedDevice != null) {
            rememberMicLabel(id, selectedDevice.label);
        }

        if (id === AUTOMATIC_MIC_ID) {
            setIsFallbackToAutomatic(false);
            setPreferredMicLabel('');
            lastFallbackMicIdRef.current = null;
        }

        await invoke('set_current_mic_id', {
            micId: id === AUTOMATIC_MIC_ID ? null : id,
        });

        void refreshMicList();
    }

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
}
