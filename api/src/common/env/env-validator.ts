import * as Sentry from '@sentry/nestjs';
import { ENV_RULES, type EnvRule } from './env-rules';

type EnvName = 'production' | 'preview' | 'development' | 'test';

function detectEnv(env: NodeJS.ProcessEnv = process.env): EnvName {
  if (
    env.VERCEL_ENV === 'production' ||
    env.VERCEL_ENV === 'preview' ||
    env.VERCEL_ENV === 'development'
  ) {
    return env.VERCEL_ENV;
  }
  if (env.NODE_ENV === 'test') return 'test';
  if (env.NODE_ENV === 'production') return 'production';
  return 'development';
}

function isStrictEnv(envName: EnvName): boolean {
  return envName === 'production' || envName === 'preview';
}

type FailureReason =
  | 'missing'
  | 'forbidden_value'
  | 'too_short'
  | 'shape_invalid'
  | 'pair_mismatch';

type Failure = {
  rule: EnvRule;
  reason: FailureReason;
  detail?: string;
};

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const envName = detectEnv(env);

  if (envName === 'test') {
    return;
  }

  const failures: Failure[] = [];
  const warnings: Failure[] = [];

  for (const rule of ENV_RULES) {
    if (rule.classification === 'optional') continue;

    const value = (env[rule.name] ?? '').trim();
    const target =
      rule.classification === 'critical' && isStrictEnv(envName)
        ? failures
        : warnings;

    if (!value) {
      target.push({ rule, reason: 'missing' });
      continue;
    }

    if (isStrictEnv(envName)) {
      if (rule.forbiddenInProd?.includes(value)) {
        target.push({ rule, reason: 'forbidden_value' });
        continue;
      }
      if (rule.minLengthInProd && value.length < rule.minLengthInProd) {
        target.push({
          rule,
          reason: 'too_short',
          detail: `min=${rule.minLengthInProd}`,
        });
        continue;
      }
      if (rule.invalidIfProd && rule.invalidIfProd(value)) {
        target.push({ rule, reason: 'shape_invalid' });
        continue;
      }
    }
  }

  for (const rule of ENV_RULES) {
    if (!rule.pairWith) continue;
    const a = (env[rule.name] ?? '').trim();
    const b = (env[rule.pairWith] ?? '').trim();
    if (!!a !== !!b) {
      const target =
        rule.classification === 'critical' && isStrictEnv(envName)
          ? failures
          : warnings;
      const already = target.some(
        (f) => f.rule.name === rule.name || f.rule.name === rule.pairWith,
      );
      if (!already) {
        target.push({
          rule,
          reason: 'pair_mismatch',
          detail: `partner=${rule.pairWith}`,
        });
      }
    }
  }

  for (const w of warnings) {
    const detailSuffix = w.detail ? ` ${w.detail}` : '';
    const line = `[EnvValidator] WARNING env=${envName} ${w.reason}=${w.rule.name}${detailSuffix} impact="${w.rule.impact}" action=continuing`;
    // eslint-disable-next-line no-console
    console.error(line);
    try {
      Sentry.captureMessage(line, 'warning');
    } catch {
      // best-effort; Sentry may not be initialized in some test paths
    }
  }

  if (failures.length > 0) {
    for (const f of failures) {
      const detailSuffix = f.detail ? ` ${f.detail}` : '';
      const line = `[EnvValidator] CRITICAL env=${envName} ${f.reason}=${f.rule.name}${detailSuffix} impact="${f.rule.impact}" action=refusing_to_start`;
      // eslint-disable-next-line no-console
      console.error(line);
      try {
        Sentry.captureMessage(line, 'fatal');
      } catch {
        // best-effort
      }
    }
    // eslint-disable-next-line no-console
    console.error(
      `[EnvValidator] FAIL env=${envName} critical_failures=${failures.length} important_warnings=${warnings.length}`,
    );
    process.exit(1);
  }

  const checked = ENV_RULES.filter((r) => r.classification !== 'optional')
    .length;
  const importantTotal = ENV_RULES.filter(
    (r) => r.classification === 'important',
  ).length;
  const criticalTotal = ENV_RULES.filter(
    (r) => r.classification === 'critical',
  ).length;
  // eslint-disable-next-line no-console
  console.log(
    `[EnvValidator] OK env=${envName} checked=${checked} critical_pass=${criticalTotal} important_pass=${importantTotal - warnings.length} important_warn=${warnings.length}`,
  );
}
