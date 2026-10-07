"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

type ClickableTableRowProps = {
  children: ReactNode;
  className?: string;
  href: string;
};

const interactiveSelector = "a, button, input, select, textarea, [data-row-navigation-ignore]";

export function ClickableTableRow({ children, className, href }: ClickableTableRowProps) {
  const router = useRouter();

  function navigate() {
    router.push(href);
  }

  function handleClick(event: MouseEvent<HTMLTableRowElement>) {
    if (isInteractiveTarget(event.target)) {
      return;
    }

    navigate();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (isInteractiveTarget(event.target) || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    navigate();
  }

  return (
    <tr
      className={`clickable-row ${className ?? ""}`}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role="link"
      tabIndex={0}
    >
      {children}
    </tr>
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(interactiveSelector));
}
