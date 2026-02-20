import { SettingsUI } from '@/components/settings-ui';
import { Typography } from '@/components/typography';
import { CircleAlert, Mic } from 'lucide-react';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/select';
import { useTranslation } from '@/i18n';
import { useMicState } from './hooks/use-mic-state';

export const MicSettings = () => {
    const { t } = useTranslation();
    const {
        currentMic,
        setMic,
        micList,
        isLoading,
        refreshMicList,
        isFallbackToAutomatic,
        preferredMicLabel,
        activeMicFallbackLabel,
    } = useMicState();

    return (
        <SettingsUI.Item>
            <SettingsUI.Description>
                <Typography.Title className="flex items-center gap-2">
                    <Mic className="w-4 h-4 text-zinc-400" />
                    {t('Microphone')}
                </Typography.Title>
                <Typography.Paragraph>
                    {t('Choose your preferred input device for recording.')}
                </Typography.Paragraph>
            </SettingsUI.Description>
            <div className={isLoading ? 'opacity-50' : ''}>
                <Select
                    value={currentMic}
                    onValueChange={setMic}
                    onOpenChange={(isOpen) => {
                        if (isOpen) {
                            void refreshMicList();
                        }
                    }}
                    disabled={isLoading}
                >
                    <SelectTrigger
                        className={
                            isFallbackToAutomatic
                                ? 'w-[240px] border-amber-400/60 text-amber-200'
                                : 'w-[240px]'
                        }
                        data-testid="mic-select"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-96">
                        {micList.map((mic) => (
                            <SelectItem
                                key={mic.id}
                                value={mic.id}
                                className={
                                    mic.isDisconnected === true
                                        ? 'text-amber-300'
                                        : undefined
                                }
                            >
                                {mic.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {isFallbackToAutomatic && preferredMicLabel.length > 0 && (
                    <Typography.Paragraph className="mt-2 max-w-[320px] flex items-start gap-2 text-amber-300">
                        <CircleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" />
                        <span className="text-xs">
                            {t(
                                '{{mic}} is disconnected. Using {{activeMic}}.',
                                {
                                    mic: preferredMicLabel,
                                    activeMic: activeMicFallbackLabel,
                                }
                            )}
                        </span>
                    </Typography.Paragraph>
                )}
            </div>
        </SettingsUI.Item>
    );
};
