import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

/*
Definir a PRIMEIRA senha de uma conta que nunca teve (entrou só por Google).
Diferente de `ChangePasswordDto`: aqui não há `currentPassword` para conferir,
porque não existe. O service só aceita quando `User.password` é null — se já
houver senha, devolve 409 e manda usar "Trocar senha".

`googleCredential` é OBRIGATÓRIO: um id_token fresco do Google (login Google
recente) cujo `sub` precisa ser um LinkedAccount deste usuário. Sem ele, só a
posse do access token (roubável) bastava para criar uma senha e persistir na
conta. Verificado por `UsersService.assertFreshProof` (spec prova-identidade).
*/
export class SetPasswordDto {

  @MinLength(8, { message: 'A senha deve ter pelo menos 8 caracteres' })
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'A senha deve conter pelo menos uma letra e um número',
  })
  password: string;

  @IsString({ message: 'A confirmação de senha é obrigatória' })
  @IsNotEmpty({ message: 'A confirmação de senha é obrigatória' })
  confirmPassword: string;

  @IsString({ message: 'Confirme sua identidade entrando com o Google.' })
  @IsNotEmpty({ message: 'Confirme sua identidade entrando com o Google.' })
  googleCredential: string;

}
