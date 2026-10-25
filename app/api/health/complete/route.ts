import { NextResponse } from 'next/server';
import { appendHealthCompletionEvent } from '@/lib/healthCompletion';
import { readHealthPlans } from '@/lib/healthPlans';

interface CompleteHealthSessionRequest {
  planId?: string;
  sourceDay?: number;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as CompleteHealthSessionRequest;
    const planId = String(body.planId || '').trim();
    const sourceDay = Number(body.sourceDay);

    if (!planId || !Number.isInteger(sourceDay) || sourceDay < 1) {
      return NextResponse.json({ error: 'planId and sourceDay are required.' }, { status: 400 });
    }

    const health = await readHealthPlans();
    const plan = health.plans.find((candidate) => candidate.id === planId);
    const session = plan?.days.find((day) => day.sourceDay === sourceDay);
    if (!plan || !session) {
      return NextResponse.json({ error: 'The selected health session was not found.' }, { status: 404 });
    }
    if (session.completed) {
      return NextResponse.json({ error: 'This health session is already completed.' }, { status: 409 });
    }
    if (session.date > health.todayDate) {
      return NextResponse.json({ error: 'A future health session cannot be marked complete.' }, { status: 409 });
    }

    const event = await appendHealthCompletionEvent({
      planId,
      sourceDay,
      completedDate: health.todayDate,
      source: 'health-dashboard',
    });

    return NextResponse.json({ event });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Unable to complete the health session.',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
