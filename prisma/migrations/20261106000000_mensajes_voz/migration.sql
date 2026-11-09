-- AlterTable
ALTER TABLE "mensajes" ADD COLUMN     "audio" TEXT,
ADD COLUMN     "audioTipo" TEXT,
ADD COLUMN     "duracionMs" INTEGER,
ADD COLUMN     "transcripcion" TEXT;
