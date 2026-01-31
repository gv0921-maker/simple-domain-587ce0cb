import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { format, parseISO, isToday, isYesterday, differenceInDays } from 'date-fns';

interface Activity {
  id: string;
  userId: string;
  userName: string;
  action: string;
  details?: string;
  timestamp: string;
}

interface ActivityTimelineProps {
  activities: Activity[];
  className?: string;
}

function formatDateHeader(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  const days = differenceInDays(new Date(), date);
  if (days < 7) return format(date, 'EEEE');
  return format(date, 'd MMM yyyy');
}

function groupActivitiesByDate(activities: Activity[]): Map<string, Activity[]> {
  const groups = new Map<string, Activity[]>();
  
  activities.forEach((activity) => {
    const dateKey = format(parseISO(activity.timestamp), 'yyyy-MM-dd');
    const existing = groups.get(dateKey) || [];
    existing.push(activity);
    groups.set(dateKey, existing);
  });
  
  return groups;
}

export function ActivityTimeline({ activities, className }: ActivityTimelineProps) {
  const groupedActivities = groupActivitiesByDate(activities);
  const sortedDates = Array.from(groupedActivities.keys()).sort((a, b) => b.localeCompare(a));

  if (activities.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        No activities yet
      </div>
    );
  }

  return (
    <div className={cn('space-y-6', className)}>
      {sortedDates.map((dateKey) => {
        const dayActivities = groupedActivities.get(dateKey) || [];
        return (
          <div key={dateKey} className="animate-fade-in">
            {/* Date header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs font-medium text-muted-foreground px-2">
                {formatDateHeader(dayActivities[0].timestamp)}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>

            {/* Activities for this date */}
            <div className="space-y-3 pl-2">
              {dayActivities.map((activity) => (
                <div key={activity.id} className="flex gap-3 group">
                  {/* Avatar */}
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className={cn(
                      'text-xs font-medium',
                      activity.userName === 'Management' 
                        ? 'bg-primary/10 text-primary' 
                        : 'bg-accent/20 text-accent-foreground'
                    )}>
                      {activity.userName.charAt(0)}
                    </AvatarFallback>
                  </Avatar>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">
                        {activity.userName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {format(parseISO(activity.timestamp), 'h:mm a')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {activity.action}
                    </p>
                    {activity.details && (
                      <p className="text-sm text-foreground mt-1 font-medium">
                        {activity.details.includes('→') ? (
                          <>
                            <span className="text-muted-foreground line-through mr-1">
                              {activity.details.split('→')[0].trim()}
                            </span>
                            →
                            <span className="text-primary ml-1">
                              {activity.details.split('→')[1].trim()}
                            </span>
                          </>
                        ) : (
                          activity.details
                        )}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
