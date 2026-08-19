"use client";

import { useState, useTransition } from "react";

import { identify, signOutOperator } from "@/app/app/team/actions";
import { Button } from "@/components/ui/primitives";
import { ROLE_DESCRIPTIONS, ROLES, type Role } from "@/lib/domain/team";
import type { Operator } from "@/lib/server/operator";

/**
 * Say who you are.
 *
 * Deliberately not styled as a login. No password field, no "sign in" heading,
 * no lock icon — this is attribution, and dressing it up as authentication would
 * tell someone they are protected by something that is not there.
 */

export function IdentifyForm({ operator }: { operator: Operator }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [role, setRole] = useState<Role>(operator.role);
  const [pending, startTransition] = useTransition();

  return (
    <div className="rounded-lg bg-card p-6 shadow-card">
      <form
        action={(formData) =>
          startTransition(async () => {
            const result = await identify(formData);
            setMessage({ ok: result.ok, text: result.message });
          })
        }
      >
        <label className="block">
          <span className="text-[14px] font-medium text-ink">Your name</span>
          <span className="mt-1.5 block text-[13px] leading-relaxed text-ink-soft">
            Goes on every approval you make. &ldquo;Someone approved this&rdquo;
            is not an audit trail.
          </span>
          <input
            name="name"
            defaultValue={operator.identified ? operator.name : ""}
            placeholder="Ada Lovelace"
            autoComplete="name"
            maxLength={60}
            className="mt-3 h-11 w-full max-w-sm rounded-sm bg-inset px-4 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>

        <fieldset className="mt-6">
          <legend className="text-[14px] font-medium text-ink">Your role</legend>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            Checked on the server for every action, not just used to hide
            buttons.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ROLES.map((option) => (
              <label
                key={option}
                className={`cursor-pointer rounded-sm border px-4 py-3 transition-colors ${
                  role === option
                    ? "border-accent bg-accent-soft"
                    : "border-line bg-inset hover:border-ink-faint"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                  className="sr-only"
                />
                <span className="block text-[14px] font-medium text-ink capitalize">
                  {option}
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-ink-soft">
                  {ROLE_DESCRIPTIONS[option]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : operator.identified ? "Update" : "That's me"}
          </Button>

          {operator.identified ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await signOutOperator();
                  setMessage({ ok: result.ok, text: result.message });
                })
              }
            >
              Clear
            </Button>
          ) : null}
        </div>

        {message ? (
          <p
            className={`mt-5 rounded-sm px-4 py-3 text-[13.5px] leading-relaxed ${
              message.ok ? "bg-safe-soft text-safe" : "bg-alert-soft text-alert"
            }`}
          >
            {message.text}
          </p>
        ) : null}
      </form>
    </div>
  );
}
