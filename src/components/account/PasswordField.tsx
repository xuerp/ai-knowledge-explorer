import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useApp } from "@/lib/app-state";

export function PasswordField({
  id,
  label,
  name,
  creating = false,
  showHint = true,
  disabled = false,
}: {
  id: string;
  label: string;
  name: string;
  creating?: boolean;
  showHint?: boolean;
  disabled?: boolean;
}) {
  const { t } = useApp();
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  useEffect(() => {
    if (disabled) setVisible(false);
  }, [disabled]);
  const shown = visible && !disabled;
  return (
    <div className="account-auth__field">
      <label htmlFor={id}>{label}</label>
      <div className="account-auth__password">
        <Input
          id={id}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={creating ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={t("输入密码", "Enter your password")}
          minLength={creating ? 12 : 1}
          required
          disabled={disabled}
          aria-describedby={
            [creating && showHint ? `${id}-hint` : "", capsLock ? `${id}-caps` : ""]
              .filter(Boolean)
              .join(" ") || undefined
          }
          onKeyDown={(event) => setCapsLock(event.getModifierState("CapsLock"))}
          onKeyUp={(event) => setCapsLock(event.getModifierState("CapsLock"))}
          onBlur={() => setCapsLock(false)}
        />
        <button
          type="button"
          className="account-auth__reveal"
          disabled={disabled}
          aria-controls={id}
          aria-label={
            shown
              ? t(`隐藏${label}`, `Hide ${label.toLowerCase()}`)
              : t(`显示${label}`, `Show ${label.toLowerCase()}`)
          }
          aria-pressed={shown}
          onClick={() => setVisible(!visible)}
        >
          {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          <span>{shown ? t("隐藏", "Hide") : t("显示", "Show")}</span>
        </button>
      </div>
      {creating && showHint && (
        <small id={`${id}-hint`}>
          {t(
            "至少 12 个字符，支持粘贴或浏览器生成的密码。",
            "At least 12 characters. Pasting and generated passwords are supported.",
          )}
        </small>
      )}
      {capsLock && (
        <small id={`${id}-caps`} className="account-auth__caps" role="status">
          {t("大写锁定已开启", "Caps Lock is on")}
        </small>
      )}
    </div>
  );
}
