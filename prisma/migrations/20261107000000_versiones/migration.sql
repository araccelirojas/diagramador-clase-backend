-- CreateEnum
CREATE TYPE "OrigenVersion" AS ENUM ('MANUAL', 'AUTOMATICA', 'IA', 'RESTAURACION');

-- CreateTable
CREATE TABLE "versiones" (
    "idVersion" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "origen" "OrigenVersion" NOT NULL,
    "nombre" TEXT,
    "contenido" JSONB NOT NULL,
    "huella" TEXT NOT NULL,
    "clases" INTEGER NOT NULL DEFAULT 0,
    "relaciones" INTEGER NOT NULL DEFAULT 0,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idProyecto" UUID NOT NULL,
    "idUsuario" UUID,

    CONSTRAINT "versiones_pkey" PRIMARY KEY ("idVersion")
);

-- CreateIndex
CREATE INDEX "versiones_idProyecto_fecha_idx" ON "versiones"("idProyecto", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "versiones_idProyecto_numero_key" ON "versiones"("idProyecto", "numero");

-- AddForeignKey
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_idProyecto_fkey" FOREIGN KEY ("idProyecto") REFERENCES "proyectos"("idProyecto") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versiones" ADD CONSTRAINT "versiones_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "usuarios"("idUsuario") ON DELETE SET NULL ON UPDATE CASCADE;
