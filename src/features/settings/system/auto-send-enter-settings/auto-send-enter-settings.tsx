import { SettingsUI } from '@/components/settings-ui';
import { Typography } from '@/components/typography';
import { Switch } from '@/components/switch';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/tooltip';
import { CornerDownLeft, Info } from 'lucide-react';
import { useAutoSendEnterState } from './hooks/use-auto-send-enter-state';
import { useTranslation } from '@/i18n';

export const AutoSendEnterSettings = () => {
    const { autoSendEnter, setAutoSendEnter } = useAutoSendEnterState();
    const { t } = useTranslation();

    return (
        <SettingsUI.Item>
            <SettingsUI.Description>
                <Typography.Title className="flex items-center gap-2">
                    <CornerDownLeft className="w-4 h-4 text-zinc-400" />
                    {t('Auto-send Enter')}
                </Typography.Title>
                <Typography.Paragraph className="flex items-start gap-2">
                    <span>
                        {t(
                            'Automatically send Enter key after pasting transcription'
                        )}
                    </span>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Info className="w-4 h-4 text-zinc-500 hover:text-zinc-300 cursor-help flex-shrink-0 mt-0.5" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                            {t(
                                'Tip: Release the recording shortcut twice quickly (within 350ms) to invert this setting for that recording'
                            )}
                        </TooltipContent>
                    </Tooltip>
                </Typography.Paragraph>
            </SettingsUI.Description>
            <Switch
                checked={autoSendEnter}
                onCheckedChange={setAutoSendEnter}
            />
        </SettingsUI.Item>
    );
};
