import { type FormEvent } from "react";

import { adminApi } from "@/services/admin-api";
import { accountErrorMessage } from "@/services/auth-errors";
import { clearAuthToken, writeAuthToken } from "@/services/auth-session";

import type { ReviewState } from "./useReviewState";
export function createSessionActions(state: ReviewState) {
  const {
    refresh,
    setBusy,
    setError,
    setGoldenQuestionReport,
    setToken,
    setUser,
    setWorkspace,
    token,
    user,
  } = state;
  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    let response: Awaited<ReturnType<typeof adminApi.login>>;
    try {
      response = await adminApi.login(String(form.get("email")), String(form.get("password")));
      if (response.user.role === "viewer") {
        throw new Error("此账户没有审核权限。");
      }
      writeAuthToken(response.accessToken);
      setToken(response.accessToken);
      setUser(response.user);
    } catch (reason) {
      setError(accountErrorMessage(reason, (zh) => zh));
      return;
    } finally {
      setBusy(false);
    }
    try {
      await refresh(response.accessToken);
    } catch (reason) {
      setError(accountErrorMessage(reason, (zh) => zh));
    }
  };

  const logout = () => {
    clearAuthToken();
    setToken("");
    setUser(null);
    setWorkspace(null);
    setGoldenQuestionReport(null);
  };

  const retryWorkspace = async () => {
    if (!token) return;
    setError("");
    try {
      await refresh(token);
    } catch (reason) {
      setError(accountErrorMessage(reason, (zh) => zh));
    }
  };
  return { login, logout, retryWorkspace };
}
