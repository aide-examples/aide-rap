# Design Brief

A system descriobing the process of publishing books.
We have Book, Author, Editor, Translation, Edition, Language, Country,
Publisher and Translator as entities.
Establish th typical foreign key relationships and add a somewhat 
rich set of attributes to each entity. We want to allow different Editions
of Translations. Reprints are seen as a special kind of Edition.
Editors only play a role when a book has multiple authors.
