import type { ComponentPropsWithRef } from "react";
import { useUrlState, useUrlStateHref } from "@/lib/url-state";

type UrlStateLinkProps = Omit<ComponentPropsWithRef<"a">, "href"> & {
  stateKey: string;
  value: string;
  defaultValue: string;
  onNavigate?: () => void;
};

export function UrlStateLink({
  stateKey,
  value,
  defaultValue,
  onClick,
  onNavigate,
  ...props
}: UrlStateLinkProps) {
  const href = useUrlStateHref(stateKey, value, defaultValue);
  const [, setValue] = useUrlState(stateKey, defaultValue, { history: "push" });

  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        // Modified clicks and context menus belong to the browser.
        if (
          event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          (props.target && props.target !== "_self") || props.download !== undefined
        ) return;

        event.preventDefault();
        setValue(value);
        onNavigate?.();
      }}
    />
  );
}
