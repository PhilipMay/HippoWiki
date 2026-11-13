-- CreateIndex
CREATE INDEX "LoginAttempt_lastFailedAt_idx" ON "LoginAttempt"("lastFailedAt");

-- CreateIndex
CREATE INDEX "LoginWindow_startedAt_idx" ON "LoginWindow"("startedAt");
