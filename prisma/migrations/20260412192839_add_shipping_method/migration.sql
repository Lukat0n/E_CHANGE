-- AlterTable
ALTER TABLE "Claim" ADD COLUMN "shippingCost" REAL;
ALTER TABLE "Claim" ADD COLUMN "shippingMethodCode" TEXT;
ALTER TABLE "Claim" ADD COLUMN "shippingMethodName" TEXT;
ALTER TABLE "Claim" ADD COLUMN "shippingMode" TEXT;
