import { NextResponse } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const CALIBRATION_PATH = path.join(VAULT_ROOT, 'structured', 'health', 'calorie-deficit-calibration-plan.json');

type DailyRecord = {
  weightKg?: number;
  intakeKcal?: number;
  fitbitTotalEnergyKcal?: number;
};

function isDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function numericValue(value: unknown, min: number, max: number) {
  if (value === null || value === undefined || value === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return numeric;
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    if (!isDate(body.date)) {
      return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
    }

    const calibration = JSON.parse(await fsp.readFile(CALIBRATION_PATH, 'utf-8'));
    if (body.date < calibration.startDate || body.date > calibration.endDate) {
      return NextResponse.json({ error: 'Date is outside the active calibration period.' }, { status: 400 });
    }

    const source = body.record || {};
    const weightKg = numericValue(source.weightKg, 35, 300);
    const intakeKcal = numericValue(source.intakeKcal, 0, 10000);
    const fitbitTotalEnergyKcal = numericValue(source.fitbitTotalEnergyKcal, 0, 10000);
    if (weightKg === null || intakeKcal === null || fitbitTotalEnergyKcal === null) {
      return NextResponse.json({ error: 'Enter realistic numeric values or leave a field empty.' }, { status: 400 });
    }

    const record: DailyRecord = {};
    if (weightKg !== undefined) record.weightKg = weightKg;
    if (intakeKcal !== undefined) record.intakeKcal = intakeKcal;
    if (fitbitTotalEnergyKcal !== undefined) record.fitbitTotalEnergyKcal = fitbitTotalEnergyKcal;

    calibration.dailyRecords = calibration.dailyRecords || {};
    if (Object.keys(record).length) calibration.dailyRecords[body.date] = record;
    else delete calibration.dailyRecords[body.date];
    calibration.updatedAt = new Date().toISOString();
    await fsp.writeFile(CALIBRATION_PATH, `${JSON.stringify(calibration, null, 2)}\n`, 'utf-8');

    return NextResponse.json({ calorieCalibration: calibration });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to save calibration record.' },
      { status: 500 }
    );
  }
}
