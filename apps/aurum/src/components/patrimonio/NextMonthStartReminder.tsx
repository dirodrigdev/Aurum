import React from 'react';
import { AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react';
import { Button, Card, cn } from '../Components';

export type NextMonthStartReminderViewModel = {
  status:
    | 'POST_CLOSE_NEXT_MONTH_READY_TO_START'
    | 'NEXT_MONTH_REQUIRES_REVIEW';
  monthKey: string;
  title: string;
  message: string;
  primaryActionLabel: string;
  primaryActionKind: 'start' | 'review';
};

type NextMonthStartReminderProps = {
  reminder: NextMonthStartReminderViewModel | null;
  modalOpen: boolean;
  onPrimaryAction: () => void;
  onSnooze: () => void;
  onCloseModal: () => void;
};

const reminderTone = (status: NextMonthStartReminderViewModel['status']) =>
  status === 'NEXT_MONTH_REQUIRES_REVIEW'
    ? {
        icon: AlertTriangle,
        banner: 'border-amber-200 bg-amber-50/90 text-amber-900',
        badge: 'border-amber-200 bg-white/90 text-amber-800',
        title: 'text-amber-950',
        body: 'text-amber-900',
      }
    : {
        icon: CheckCircle2,
        banner: 'border-emerald-200 bg-emerald-50/90 text-emerald-900',
        badge: 'border-emerald-200 bg-white/90 text-emerald-700',
        title: 'text-emerald-950',
        body: 'text-emerald-900',
      };

export const NextMonthStartReminder: React.FC<NextMonthStartReminderProps> = ({
  reminder,
  modalOpen,
  onPrimaryAction,
  onSnooze,
  onCloseModal,
}) => {
  if (!reminder) return null;

  const tone = reminderTone(reminder.status);
  const ToneIcon = tone.icon;

  return (
    <>
      <Card className={cn('border p-3 shadow-sm', tone.banner)}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-semibold leading-none shadow-sm">
              <ToneIcon size={13} />
              {reminder.status === 'NEXT_MONTH_REQUIRES_REVIEW' ? 'Revisión pendiente' : 'Siguiente paso'}
            </div>
            <div className={cn('mt-2 text-sm font-semibold', tone.title)}>{reminder.title}</div>
            <div className={cn('mt-1 text-xs leading-relaxed', tone.body)}>{reminder.message}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="outline" className={cn('bg-white/90', tone.badge)} onClick={onSnooze}>
              <Clock3 size={14} className="mr-1" />
              Recordarme después
            </Button>
            <Button size="sm" onClick={onPrimaryAction}>
              {reminder.primaryActionLabel}
            </Button>
          </div>
        </div>
      </Card>

      {modalOpen ? (
        <div className="fixed inset-0 z-[96] flex items-end justify-center bg-black/35 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className={cn('mt-0.5 rounded-full border p-2', tone.badge)}>
                <ToneIcon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-lg font-semibold text-slate-900">{reminder.title}</div>
                <div className="mt-2 text-sm leading-relaxed text-slate-600">{reminder.message}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={onSnooze}>
                Recordarme después
              </Button>
              <Button variant="outline" onClick={onCloseModal}>
                Cerrar
              </Button>
              <Button onClick={onPrimaryAction}>{reminder.primaryActionLabel}</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
