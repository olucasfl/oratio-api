import { IsNotEmpty, IsString } from 'class-validator';

export class GoogleLoginDto {

  /*
  O `credential` é o id_token (JWT) que o Google Identity Services entrega no
  callback do botão "Entrar com Google" no frontend. O backend verifica a
  assinatura, o `aud`, o `iss`, o `exp` e exige `email_verified: true` antes
  de resolver a conta. Não há campo `nonce`: a versão de fachada (frontend
  gera, backend compara com o payload) não protege de replay — ver
  docs/specs/login-google.md, "Fora de escopo".
  */
  @IsString({ message: 'credential é obrigatório' })
  @IsNotEmpty({ message: 'credential é obrigatório' })
  credential: string;

}
