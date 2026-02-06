import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export default function Empty() {
  const { t } = useTranslation();
  return (
    <div className={cn('flex h-full items-center justify-center')}>{t('common.empty')}</div>
  );
}
