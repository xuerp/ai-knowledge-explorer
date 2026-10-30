import { type FormEvent } from "react";

import { adminApi } from "@/services/admin-api";
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
    try {
      const response = await adminApi.login(
        String(form.get("email")),
        String(form.get("password")),
      );
      if (response.user.role === "viewer") {
        throw new Error("This account does not have reviewer access.");
      }
      writeAuthToken(response.accessToken);
      setToken(response.accessToken);
      setUser(response.user);
      await refresh(response.accessToken);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Login failed.");
    } finally {
      setBusy(false);
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
    setBusy(true);
    setError("");
    try {
      await refresh(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "审核工作区加载失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return { login, logout, retryWorkspace };
}
