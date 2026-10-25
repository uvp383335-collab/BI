"""Command line: python -m loader {load,validate,reset} --config config.json"""
import argparse
import json

from . import reset as reset_mod
from .client import Salesforce
from .config import Config, ALL_STEPS
from .idmap import IdMaps
from .load import Loader, log
from .validate import Validator, write_report


def main():
    ap = argparse.ArgumentParser(prog="loader", description="Ridgeline -> Salesforce sandbox loader")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_load = sub.add_parser("load", help="run load steps (all steps in config by default)")
    p_load.add_argument("--steps", help=f"comma-separated subset of: {','.join(ALL_STEPS)}")
    p_load.add_argument("--limit", type=int, help="only the first N records per object (smoke test)")
    p_load.add_argument("--no-validate", action="store_true", help="skip validation after loading")

    p_val = sub.add_parser("validate", help="run the validation checks and write a report")
    p_val.add_argument("--sample", type=int, help="check N random records per object instead of all")

    p_reset = sub.add_parser("reset", help="delete the loaded records (dry run unless --yes)")
    p_reset.add_argument("--yes", action="store_true", help="actually delete")

    for p in (p_load, p_val, p_reset):
        p.add_argument("--config", required=True)
    args = ap.parse_args()

    cfg = Config(args.config)
    sf = Salesforce(cfg.org_alias)
    org = sf.guard(cfg.org_id, cfg.allow_production)
    log(f"org {sf.org_id} ({org['OrganizationType']}, {org['Name']}), dataset {cfg.dataset_dir}")
    maps = IdMaps(cfg.output_dir)

    if args.cmd == "load":
        steps = args.steps.split(",") if args.steps else cfg.steps
        loader = Loader(cfg, sf, maps, limit=args.limit)
        for step in steps:
            log(f"== step {step}")
            getattr(loader, f"step_{step}")()
        summary_path = cfg.output_dir / "reports" / "last_load_summary.json"
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(json.dumps(loader.summary, indent=1), encoding="utf-8")
        if not args.no_validate and not args.limit:
            results = Validator(cfg, sf, maps).run()
            log(f"report: {write_report(cfg, results, loader.summary)}")
    elif args.cmd == "validate":
        results = Validator(cfg, sf, maps, sample=args.sample).run()
        log(f"report: {write_report(cfg, results)}")
    elif args.cmd == "reset":
        reset_mod.run(cfg, sf, dry_run=not args.yes)


if __name__ == "__main__":
    main()
