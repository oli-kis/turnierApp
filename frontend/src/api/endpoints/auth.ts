import { z } from "zod";
import { apiRequest } from "../client";
import { UserSchema } from "../types";

const LoginResponse = z.object({ token: z.string(), user: UserSchema });
const UserResponse = z.object({ user: UserSchema });

export function login(email: string, password: string) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: { email, password },
    schema: LoginResponse,
  });
}

export function register(email: string, name: string, password: string) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: { email, name, password },
    schema: UserResponse,
  });
}

export function getMe() {
  return apiRequest("/auth/me", { schema: UserResponse });
}
