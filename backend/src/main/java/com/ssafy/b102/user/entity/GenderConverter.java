package com.ssafy.b102.user.entity;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/** Gender ↔ CHAR(1). @Enumerated(STRING) 은 VARCHAR 로 매핑돼 ddl-auto=validate 가 CHAR 컬럼과 어긋난다. */
@Converter
public class GenderConverter implements AttributeConverter<Gender, String> {

	@Override
	public String convertToDatabaseColumn(Gender attribute) {
		return attribute == null ? null : attribute.code();
	}

	@Override
	public Gender convertToEntityAttribute(String dbData) {
		return dbData == null || dbData.isBlank() ? null : Gender.fromCode(dbData.trim());
	}
}
