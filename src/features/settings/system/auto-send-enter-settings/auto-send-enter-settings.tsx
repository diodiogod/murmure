import { SettingsUI } from '@/components/settings-ui';
import { Typography } from '@/components/typography';
import { Switch } from '@/components/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/tooltip';
import { CornerDownLeft, Info } from 'lucide-react';
import { useTranslation } from '@/i18n';
import { useAutoSendEnterState } from './hooks/use-auto-send-enter-state';

export const AutoSendEnterSettings = () => {
    const { autoSendEnter, setAutoSendEnter } = useAutoSendEnterState();
    const { t } = useTranslation();

    return (
        <SettingsUI.Item>
            <SettingsUI.Description>
                <Typography.Title className="flex items-center gap-2">
                    <CornerDownLeft className="w-4 h-4 text-muted-foreground" />
                    {t('Auto-send Enter')}
                </Typography.Title>
                <Typography.Paragraph className="flex items-start gap-2">
                    <span>{t('Automatically press Enter after pasting keyboard-triggered transcription.')}</span>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Info className="w-4 h-4 mt-0.5 shrink-0 cursor-help text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                            {t('Release the recording shortcut twice quickly to invert this setting for one recording.')}
                        </TooltipContent>
                    </Tooltip>
                </Typography.Paragraph>
            </SettingsUI.Description>
            <Switch checked={autoSendEnter} onCheckedChange={setAutoSendEnter} />
        </SettingsUI.Item>
    );
};
