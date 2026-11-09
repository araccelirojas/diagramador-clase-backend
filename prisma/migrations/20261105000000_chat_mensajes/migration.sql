-- CreateEnum
CREATE TYPE "AutorMensaje" AS ENUM ('USUARIO', 'IA');

-- CreateEnum
CREATE TYPE "TipoMensaje" AS ENUM ('TEXTO', 'VOZ');

-- CreateTable
CREATE TABLE "mensajes" (
    "idMensaje" UUID NOT NULL,
    "autor" "AutorMensaje" NOT NULL,
    "tipo" "TipoMensaje" NOT NULL DEFAULT 'TEXTO',
    "texto" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idCliente" TEXT,
    "idProyecto" UUID NOT NULL,
    "idUsuario" UUID,
    "respondeA" UUID,
    "mencionA" UUID,

    CONSTRAINT "mensajes_pkey" PRIMARY KEY ("idMensaje")
);

-- CreateIndex
CREATE INDEX "mensajes_idProyecto_fecha_idx" ON "mensajes"("idProyecto", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "mensajes_idUsuario_idCliente_key" ON "mensajes"("idUsuario", "idCliente");

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_idProyecto_fkey" FOREIGN KEY ("idProyecto") REFERENCES "proyectos"("idProyecto") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_idUsuario_fkey" FOREIGN KEY ("idUsuario") REFERENCES "usuarios"("idUsuario") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_respondeA_fkey" FOREIGN KEY ("respondeA") REFERENCES "mensajes"("idMensaje") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_mencionA_fkey" FOREIGN KEY ("mencionA") REFERENCES "usuarios"("idUsuario") ON DELETE SET NULL ON UPDATE CASCADE;
