export interface SectionTask {
  status: string;
  date?: string;
  horizon?: string;
  needsPlannerReview?: boolean;
}

// Display classification only: never reschedule or mutate the source commitment.
export function groupPlannerTasks<T extends SectionTask>(tasks: T[], today?: string, tomorrow?: string) {
  const sections: Record<'today' | 'tomorrow' | 'future' | 'waiting' | 'later' | 'review', T[]> = {
    today: [], tomorrow: [], future: [], waiting: [], later: [], review: [],
  };
  for (const task of tasks) {
    if (['done', 'archived', 'dropped', 'cancelled'].includes(task.status)) continue;
    if (['waiting', 'blocked'].includes(task.status)) sections.waiting.push(task);
    else if (task.status === 'paused') sections.later.push(task);
    else if (task.needsPlannerReview || (task.date && today && task.date < today)) sections.review.push(task);
    else if (task.status === 'review' || task.status === 'suggested' || task.horizon === 'review') sections.review.push(task);
    else if (task.date) {
      if (task.date === today) sections.today.push(task);
      else if (task.date === tomorrow) sections.tomorrow.push(task);
      else sections.future.push(task);
    } else if (today && task.horizon === 'today') sections.today.push(task);
    else if (tomorrow && task.horizon === 'tomorrow') sections.tomorrow.push(task);
    else sections.later.push(task);
  }
  return sections;
}
