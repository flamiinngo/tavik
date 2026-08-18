"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/primitives";
import {
  composeStatement,
  findSourcePreset,
  findTargetPreset,
  SOURCE_PRESETS,
  TARGET_PRESETS,
  type SelectorPreset,
} from "@/lib/domain/rule-presets";
import { createRule, type CreateRuleResult } from "@/app/app/boundaries/new/actions";

/**
 * Write a rule.
 *
 * Built as a sentence rather than a form. A rule *is* a sentence — "these must
 * never reach those" — and asking someone to fill in selector fields to express
 * it makes them translate their own intent into the system's vocabulary. Here
 * they pick the two halves and read the finished sentence back before saving.
 *
 * The sentence updates live, so what gets saved is never a surprise.
 */

export function RuleBuilder() {
  const [sourceId, setSourceId] = useState(SOURCE_PRESETS[0].id);
  const [targetId, setTargetId] = useState(TARGET_PRESETS[0].id);
  const [name, setName] = useState("");
  const [result, setResult] = useState<CreateRuleResult | null>(null);
  const [pending, startTransition] = useTransition();

  const source = findSourcePreset(sourceId)!;
  const target = findTargetPreset(targetId)!;
  const sentence = composeStatement(source, target);

  if (result?.ok) {
    const broken = result.status === "violated";
    return (
      <div className="rounded-lg bg-card p-8 shadow-card">
        <p
          className={`text-[12px] font-semibold uppercase tracking-[0.14em] ${
            broken ? "text-alert" : result.status === "verified" ? "text-safe" : "text-idle"
          }`}
        >
          {broken ? "Already broken" : result.status === "verified" ? "Holding" : "Saved"}
        </p>
        <h3 className="mt-3 text-[26px] font-semibold leading-tight tracking-tight text-ink">
          {result.message}
        </h3>
        <p className="mt-4 text-[14.5px] leading-relaxed text-ink-soft">
          Checked against your real graph in {result.elapsedMs}ms, the moment it was
          saved.
        </p>

        <div className="mt-7 flex flex-wrap gap-3">
          <Link href={`/app/boundaries/${result.ruleId}`}>
            <Button variant="primary">
              {broken ? "See how, and fix it" : "See the proof"} <span aria-hidden>↗</span>
            </Button>
          </Link>
          <Button
            onClick={() => {
              setResult(null);
              setName("");
            }}
          >
            Write another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => setResult(await createRule(formData)))
      }
      className="rounded-lg bg-card p-8 shadow-card"
    >
      {/* The sentence, assembled live. */}
      <p className="text-[12.5px] font-medium uppercase tracking-[0.16em] text-ink-subtle">
        Your rule
      </p>
      <p className="mt-4 text-[22px] leading-snug tracking-tight text-ink">{sentence}</p>

      <div className="mt-9 space-y-8">
        <Choice
          legend="What should never get through?"
          name="source"
          options={SOURCE_PRESETS}
          value={sourceId}
          onChange={setSourceId}
        />
        <Choice
          legend="What are you protecting?"
          name="target"
          options={TARGET_PRESETS}
          value={targetId}
          onChange={setTargetId}
        />

        <label className="block">
          <span className="text-[14px] font-medium text-ink">Call it something short</span>
          <input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Outside publishers"
            maxLength={60}
            className="mt-2 h-11 w-full rounded-sm bg-inset px-4 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>

        <label className="block">
          <span className="text-[14px] font-medium text-ink">How far should it look?</span>
          <select
            name="maxHops"
            defaultValue="8"
            className="mt-2 h-11 w-full rounded-sm bg-inset px-4 text-[15px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="4">Up to 4 steps — direct and near dependencies</option>
            <option value="8">Up to 8 steps — recommended</option>
            <option value="12">Up to 12 steps — slower, very thorough</option>
          </select>
          {/* Saying what was checked is part of being honest about the answer:
              a rule checked to 8 steps has not been checked to 9. */}
          <span className="mt-1.5 block text-[12.5px] text-ink-subtle">
            Tavik will report exactly how far it looked, so the answer is never
            overstated.
          </span>
        </label>
      </div>

      {result && !result.ok ? (
        <p className="mt-6 rounded-sm bg-alert-soft px-4 py-3 text-[13.5px] text-alert">
          {result.message}
        </p>
      ) : null}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={pending}
        className="mt-8 w-full"
      >
        {pending ? "Saving and checking…" : "Save and check it now"}
      </Button>
    </form>
  );
}

function Choice({
  legend,
  name,
  options,
  value,
  onChange,
}: {
  legend: string;
  name: string;
  options: readonly SelectorPreset[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[14px] font-medium text-ink">{legend}</legend>
      <div className="mt-3 space-y-2">
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-3 rounded-sm p-4 transition-colors ${
                selected ? "bg-accent-soft ring-1 ring-accent-line" : "bg-inset hover:bg-sunken"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
                className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span className="min-w-0">
                <span className="block text-[14.5px] font-medium text-ink">
                  {option.label}
                </span>
                <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
