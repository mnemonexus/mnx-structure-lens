// Checks content/** against content/SCHEMA.md: node dev/verify-content.mjs   (errors fail, warnings are notes)
import { check, load } from './content-lib.mjs';

export function report() {
  const content = load();
  const issues = check(content);
  for (const i of issues) console.log(`${i.level === 'error' ? 'ERROR  ' : 'warning'} ${i.where}: ${i.msg}`);
  const errors = issues.filter((i) => i.level === 'error').length;
  console.log(`\n${content.labels.length} label activities, ${content.finds.length} find activities, ${content.facts.length} facts: ${errors} error(s), ${issues.length - errors} warning(s)`);
  return errors;
}
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('verify-content.mjs')) process.exitCode = report() ? 1 : 0;
