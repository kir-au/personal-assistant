import { NextResponse } from 'next/server';
import fsp from 'fs/promises';
import path from 'path';

const VAULT_ROOT = path.join(process.env.HOME || '', 'personal-vault');
const CALIBRATION_PATH = path.join(VAULT_ROOT, 'structured', 'health', 'calorie-deficit-calibration-plan.json');

type DailyRecord = {
  weightKg?: number;
  weightTrendEligible?: boolean;
  weightNote?: string;
  foodLog?: string;
  intakeKcal?: number;
  intakeComplete?: boolean;
  fitbitTotalEnergyKcal?: number;
  wakeTime?: string;
  walkMinutes?: number;
  coffeeServings?: number;
  lastCoffeeTime?: string;
  alcoholDrinks?: number;
  alcoholKcal?: number;
  alcoholContext?: string;
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

function timeValue(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function textValue(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maxLength) return null;
  return value.trim() || undefined;
}

function booleanValue(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  return typeof value === 'boolean' ? value : null;
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
    const weightTrendEligible = booleanValue(source.weightTrendEligible);
    const weightNote = textValue(source.weightNote, 500);
    const foodLog = textValue(source.foodLog, 1200);
    const intakeKcal = numericValue(source.intakeKcal, 0, 10000);
    const intakeComplete = booleanValue(source.intakeComplete);
    const fitbitTotalEnergyKcal = numericValue(source.fitbitTotalEnergyKcal, 0, 10000);
    const wakeTime = timeValue(source.wakeTime);
    const walkMinutes = numericValue(source.walkMinutes, 0, 600);
    const coffeeServings = numericValue(source.coffeeServings, 0, 20);
    const lastCoffeeTime = timeValue(source.lastCoffeeTime);
    const alcoholDrinks = numericValue(source.alcoholDrinks, 0, 30);
    const alcoholKcal = numericValue(source.alcoholKcal, 0, 5000);
    const alcoholContext = textValue(source.alcoholContext, 500);
    if (
      weightKg === null
      || weightTrendEligible === null
      || weightNote === null
      || foodLog === null
      || intakeKcal === null
      || intakeComplete === null
      || fitbitTotalEnergyKcal === null
      || wakeTime === null
      || walkMinutes === null
      || coffeeServings === null
      || lastCoffeeTime === null
      || alcoholDrinks === null
      || alcoholKcal === null
      || alcoholContext === null
    ) {
      return NextResponse.json({ error: 'Enter realistic numeric values or leave a field empty.' }, { status: 400 });
    }

    const record: DailyRecord = {};
    if (weightKg !== undefined) record.weightKg = weightKg;
    if (weightTrendEligible !== undefined) record.weightTrendEligible = weightTrendEligible;
    if (weightNote !== undefined) record.weightNote = weightNote;
    if (foodLog !== undefined) record.foodLog = foodLog;
    if (intakeKcal !== undefined) record.intakeKcal = intakeKcal;
    if (intakeComplete !== undefined) record.intakeComplete = intakeComplete;
    if (fitbitTotalEnergyKcal !== undefined) record.fitbitTotalEnergyKcal = fitbitTotalEnergyKcal;
    if (wakeTime !== undefined) record.wakeTime = wakeTime;
    if (walkMinutes !== undefined) record.walkMinutes = walkMinutes;
    if (coffeeServings !== undefined) record.coffeeServings = coffeeServings;
    if (lastCoffeeTime !== undefined) record.lastCoffeeTime = lastCoffeeTime;
    if (alcoholDrinks !== undefined) record.alcoholDrinks = alcoholDrinks;
    if (alcoholKcal !== undefined) record.alcoholKcal = alcoholKcal;
    if (alcoholContext !== undefined) record.alcoholContext = alcoholContext;

    calibration.dailyRecords = calibration.dailyRecords || {};
    if (Object.keys(record).length) {
      calibration.dailyRecords[body.date] = {
        ...(calibration.dailyRecords[body.date] || {}),
        ...record,
      };
    }
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
